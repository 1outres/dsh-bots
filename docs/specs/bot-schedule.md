# ボットのスケジュール機能 仕様案

状態: 1 は実装済み。2–4 は `feat/bot-schedule` で実装（末尾「実装で確定したこと」）

## 目的

ボットが自分で「あとで」「定期的に」動く予定を作り、管理できるようにする。
ユーザに届く文は必ず Main セッションのモデルが書く。

## 前提と配置

- 機能は **bot-core の中**（`host/schedule/`）に置く。
  セッションの作成（設計ルール 1）、ボットのグループ内へのツール登録（ルール 34）、Main への入力は
  bot-core にしか許されていないため、別パッケージに切り出すと契約の抜け道が必要になる。
- 時刻の計算（cron 式の解釈、次回時刻、取りこぼし時の直近1回の選択）は
  `@deepseek-ai/dsh-schedule` と、その下の `@deepseek-ai/dsh-util-time` が公開する純粋関数を使い、自作しない。保存・発火・配信は bot-core が持つ。
  DSH の `ScheduleService` は `Bot.createSession` を通らずにセッションを作るので使わない。
- Main への入力は、作業中の `feat/connector-actions` が導入する **notice outbox**
  （`host/notices/`、Main への永続的な配信）に topic `schedule` を足して使う。

## 1. 「このターンは送らない」（スケジュールとは独立した機能）

Main の返答は、assistant メッセージが確定するたびにチャネルへ流れる（`host/channels/feed.ts`）。
送ったものは取り消せないので、「送らない」は **宣言した時点以降** に効く。

- ツール `stay_silent`（Main セッションのみ、引数 `reason?: string`）。
- 呼ばれたら、そのターンの残りの assistant 本文はチャネルに送らない。Web UI と履歴には残る。
- ターン状態（started/completed）はチャネルに通常どおり流す。
  ただし silent になったターンの completed では、channel 側が「入力中」表示を止める以上のことをしない。
- 呼び出しが成功すると、そのターンを終える（dsh-tools の `exec.concludeTurn()`）。同じメッセージの他のツール呼び出しは実行され、その結果はモデルが次のターンで見る。断られた呼び出し（Main 以外、古い版）は終えない。
  終えないと、モデルは結果の後のステップで何も書かずに空の応答を返しやすく、DSH はそれを `EMPTY_RESPONSE` としてリトライし、最後はターンを失敗にする。ターンの終わりはモデルに任せず、ツールで決める。
- ツール説明: 「このターンを終え、これ以上ユーザに何も伝えない。呼び出しはターンを終えるので、やることを済ませてから最後に呼ぶ。同じメッセージの他の呼び出しは実行される。呼ぶ前に書いた文はもう届いている」。
- プロンプトの文面も「書く前に呼ぶ」ではなく「書く代わりに stay_silent でターンを終える」にする（docs/specs/bot-system-prompt.md、bot-collab.md、bot-heartbeat.md）。
- 型: feed は `BotChannelOutput` を publish する前に、そのセッションの現在のターンが silent かを問い合わせる。
  silent の状態は「セッションID → ターン」の単位で持ち、`turn/end` で消える。

## 2. ジョブのモデル

```ts
type ScheduleMode = "main" | "separate"

type Schedule =
  | { readonly kind: "at"; readonly at: string } // ISO 8601。オフセット無しはジョブの timezone
  | { readonly kind: "after"; readonly delay: string } // "30m" "2h"。作成時に at へ確定して保存
  | { readonly kind: "every"; readonly interval: string } // 最短 5m
  | { readonly kind: "cron"; readonly expr: string } // 5 フィールド、ジョブの timezone

interface ScheduleCheck {
  readonly command: string // ボットの VM で bash -c
  readonly timeoutSeconds: number // 既定 60、上限 300
}

interface ScheduleJob {
  readonly id: string
  readonly botId: string
  readonly name: string
  readonly mode: ScheduleMode
  readonly schedule: StoredSchedule // after は at に確定済み
  readonly timezone: string // 作成時に確定（bot 設定 → 引数で上書き）
  readonly instruction: string
  readonly check?: ScheduleCheck
  readonly enabled: boolean
  readonly createdBy: { readonly sessionId: string }
  readonly createdAt: number
  readonly nextRunAt?: number // 無い = 終了（at の実行後）
  readonly lastRun?: ScheduleRunSummary
  readonly failureStreak: number
}
```

- 保存は bot-core の domain（ルール 27 のスナップショット対象）`dsh_bot_schedules`、テーブル `jobs` と `runs`（直近 N 件）。
- 上限: ボットごと 20 ジョブ。`every` は 5 分以上、`cron` も隣接2回の間隔が 5 分未満なら拒否。
- bot の設定に `timezone`（IANA）を追加。作成時に作成ダイアログで決める（初期値はブラウザのタイムゾーン、`BotCreateInput.timezone` は必須）。

## 3. 1回の実行

```
発火
 ├─ 前回の実行が終わっていない → skipped(overlap) を記録して終了
 ├─ check あり → VM で実行
 │    ├─ exit 0 → 標準出力（上限 16KB）を checkOutput として次へ
 │    ├─ exit 1 → quiet を記録して終了（モデルを呼ばない）
 │    └─ その他 / タイムアウト → failed(check) → 失敗の通知へ
 ├─ mode=main     → Main に notice（指示文 + checkOutput）
 └─ mode=separate → Bot.createSession で別セッションを開き、指示文 + checkOutput で1ターン実行
       ├─ schedule_result {outcome:"report", report} → Main に notice（report）
       ├─ schedule_result {outcome:"nothing"}       → nothing を記録して終了
       └─ 呼ばずに終了 / エラー                     → failed(run) → 失敗の通知へ
```

- 取りこぼし（Host 停止中）は直近の1回だけ実行し、本来の予定時刻と遅れを notice に含める。
  期限切れの at も1回だけ実行する。
- 失敗の通知は Main への notice。連続失敗中は最初の1回と、回復した回だけ送る。
- 手動の `run` は結果を必ず Main に送る（quiet、nothing、連続失敗中の失敗も）。時刻による実行は上の規則のまま。
- Main がターンの途中なら、schedule の notice はそのターンに混ぜず、ターンが終わってから自分のターンとして処理される
  （notice の topic ごとの配信タイミング。schedule は `next-turn`）。混ぜると、schedule の分で呼んだ `stay_silent` が
  ユーザへの返答まで止めてしまう。
- separate のセッションは実行後にアーカイブする。Web UI からは辿れる。

### Main に届く notice の本文

```
[schedule] "<name>" (<id>) — scheduled <予定時刻 local>, ran <実行時刻 local>[, late by <遅れ>]
kind: run | result | failure
<mode=main: instruction / mode=separate: report / failure: 何が失敗したか、exit code、stderr の末尾>
[check output: ...]
```

Main は普段どおり返答する。伝えることが無ければ `stay_silent` を使う。

## 4. エージェント向けツール

### `schedule`（Main セッション）

| action   | 引数                                                 | 結果                                               |
| -------- | ---------------------------------------------------- | -------------------------------------------------- |
| `create` | name, mode, schedule, instruction, check?, timezone? | ジョブ + 次回3回分（ジョブの timezone の現地時刻） |
| `list`   | —                                                    | 全ジョブの要約（次回、直近の結果、enabled）        |
| `update` | id + 変えたい項目（enabled 含む）                    | ジョブ + 次回3回分                                 |
| `delete` | id                                                   | 削除したジョブ                                     |
| `run`    | id                                                   | 受け付けた旨。結果は後で Main に届く               |

ツール説明に入れる判断基準:

> Use `main` when the work should continue this conversation, with its context and leaving its steps in it.
> Use `separate` when it should run apart from the conversation and only its outcome should come back to you;
> its instruction must then stand on its own.
> For a wait within the current turn, use a background command instead of a schedule.

### separate のセッションに出すツール

- `schedule_result`: `{ outcome: "report", report: string } | { outcome: "nothing" }`。1回だけ呼べる。
- `schedule` は自分のジョブの `update` / `delete` だけ（`id` は不要、自分に固定）。

モデルの指定はどのツールにも出さない。

## 5. 実装の順序

1. `stay_silent`（bot-core の feed とツール行）。他と独立。
2. `feat/connector-actions` の notice outbox が main に入るのを待つ。
3. bot-core: 設定 `timezone`、domain `dsh_bot_schedules`、`host/schedule/`（store / timer / runner）、
   separate セッションの起動、ツール `schedule` と `schedule_result`、notice topic `schedule`。

Web UI での一覧・管理は最初の範囲に含めない。

## 実装で確定したこと

実装中に決めた、または上の記述から変えた点（理由つき）。

- **時刻ライブラリ**: `@deepseek-ai/dsh-schedule` は `parseCronInput`（cron の検証と正規化）と
  `resolveEveryOccurrence`（every の取りこぼし判定）を使う。cron の次回・取りこぼし判定、cron のフィールド、
  タイムゾーンの正規化、`at` の解釈、期間の表示は `@deepseek-ai/dsh-util-time`（`Cron`、`canonicalizeTimeZone`、
  `parseOffsetInstant` / `parseLocalCalendar` / `resolveLocalInstant`、`Duration`）を使う。
  dsh-schedule の `resolveCronOccurrence` などは id・title・prompt を持つ DSH のレコード型を要求し、
  中身は `Cron.resolve` と同じなので、レコードを偽造せずに済む下位の関数を選んだ。どちらも DSH 同梱で、
  bot-core の他の `@deepseek-ai/*` と同じく peerDependency（ビルドでは external）。
- **cron の 5 分制限**: 隣接2回の間隔は cron の分・時フィールド（`Cron.fields`）から求める。
  同じ時の中の分どうし、および連続する時（23 → 0 を含む。翌日が一致するかは見ない）の境目。
  夏時間の切り替えで縮む間隔は見ない。全発生の列挙は 1 回 1 ms 程度かかり、上限を決められないため。
- **every の起点**: 作成（または schedule の変更）時刻。最初の実行はその 1 間隔後。
- **無効化と再開**: 再開した繰り返しジョブは停止中の分を実行せず、再開時刻から次回を求める。
  `at` はそのまま（期限切れなら 1 回だけ実行）。
- **notice の kind**: `run` / `result` / `failure` に `recovery` を足した。回復した実行が他に伝えることを持たない
  （check が exit 1、separate が nothing）とき、回復だけを伝える。回復した実行が `run` / `result` を送るときは、
  その本文に「N 回連続の失敗の後に成功した」と書く。手動の `run` は見出しが「run on request, ran …」になる。
- **手動の実行は必ず答える**: `run` の結果文（「結果は後で notice で届く」）を正しくするため、手動の実行は
  時刻による実行なら何も送らない結果でも notice を送る。quiet と nothing は見出しと1行だけ
  （`kind: quiet — the check found nothing to do` / `kind: nothing — the run found nothing worth telling`）、
  失敗は通常の failure。連続失敗の数には手動の実行も数え、回復の notice もそのまま。
  どの notice を送るかは純粋関数 `chooseNotice`（`host/schedule/choice.ts`）が決める。
- **failure の「以後の失敗は伝えない」の行**: ジョブに次の実行がある（繰り返しで、有効で次回がある）ときだけ付ける。
  `at` / `after` と、無効・終了したジョブには付けない。
- **separate の時間制限**: 60 分で失敗にする（セッションはアーカイブで止める）。仕様に無かったが、
  終わらない実行があると以後すべて skipped(overlap) になるため。
- **`run` アクション中の重複**: 実行中のジョブに `run` を呼ぶとツールのエラーで断る（記録はしない）。
  時刻による発火の重複だけを skipped(overlap) として記録する。
- **ツールの見せ方**: dsh-tools の `register(definition, { when })`（ステップごとの有効条件）で、
  `schedule` は Main と separate のセッションだけ、`schedule_result` は separate のセッションだけに見せる。
  isolation（`tools.restrict`）は Host ツール用で、行のツールはこちらの方が素直。届いた呼び出しは bot-core でも断る。
- **ツール行**: channel 行に足さず、専用の行 `env-bot-core-schedule`（`plugins/schedule.ts`）にした。
  ルール 34 の例外にこのファイルを足した。
- **notice の配信タイミング**: notice の契約に topic ごとの型付きのタイミング `NOTICE_DELIVERY` を足した
  （`host/notices/delivery.ts`）。`connector` は `next-step`（実行中のターンの次のステップに inject、従来どおり）、
  `schedule` は `next-turn`（実行中でも `followup`。DSH の `followup` は「その項目だけを通常メッセージとする自分のターン」を
  キューに積み、実行中のターンの後に開く）。実行中の Agent の inbox で待っている notice はそのまま待たせ、
  inbox から落ちたものは Agent が idle になってから同じ message id で送り直す。
- **保存**: `runs` はジョブごとに終わった実行の直近 20 件。ジョブを消すと実行記録も消える。
  `dsh_bot_schedules` の書き込みは `host/schedule/store.ts` だけ（設計ルール 42 を追加）。
  notice の topic を足したので `dsh_bot_notices` は version 2（version 1 と互換）。
- **bot の timezone**: `BotRecord.timezone`（省略可のフィールド、互換）。新しいボットは作成時に送られたタイムゾーン（ブラウザのもの）、
  タイムゾーンの無い既存のボット（それまで Host のタイムゾーンで動いていた）は起動時に一度だけ Host のタイムゾーンを書き込む。`BotView.timezone` と `bots` Remote の `update` で読み書きし、
  設定の General に入力欄を足した（スケジュール自体の Web UI は範囲外のまま）。
