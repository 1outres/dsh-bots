# ボットの heartbeat

状態: `feat/heartbeat` で実装（末尾「実装で確定したこと」）

## 目的

コネクターのイベントを `queue` で受けるボットは、Main が `<connector>_events_list` / `<connector>_events_ack` で取りに行くまでイベントを溜める。docs/specs/bot-connectors.md §10.3 は「schedule の check と組み合わせる」としていたが、check はボットの VM で動くので Host のイベントストアは見えず、queue を定期的に処理する仕組みが無かった。

heartbeat は、ボットごとに一定の間隔で Main を起こし、待っているイベントとボット自身が書いた定期の確認（workspace の `HEARTBEAT.md`）を処理させる。やることが無い回はモデルを呼ばない。

参考にしたもの:

- OpenClaw の旧 heartbeat: `HEARTBEAT.md` が空かコメント・見出しだけならモデルを呼ばない。新版はファイルが無いときも動き、30 分ごとに無駄な呼び出しになった（openclaw#202146）。ここではファイルが無いときも呼ばない。
- Hermes Agent: idle のときだけ発火し、溜まった回は 1 回にまとめる。「やることが無ければそう言って止まる。仕事を作らない」。
- OpenClaw の `HEARTBEAT_OK` のような目印は使わない。伝えることが無いときは既存の `stay_silent` を使う。

## 1. 配置

- bot-core の `host/heartbeat/`。Main への入力（notice outbox）、イベントストア、ボットの環境の fs、設定の目録はどれも bot-core にあるので、別パッケージにしない。schedule のジョブにもしない（ジョブはボットが作って消すもの、heartbeat はボットの組み込みの動き）。
- 状態とロジックを分ける:

| ファイル                           | 役目                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------- |
| `shared/heartbeat.ts`              | 設定の型、既定値、範囲、検査（`parseHeartbeatSettings`）、Remote の型      |
| `host/heartbeat/domain.ts`         | 保存ドメイン `dsh_bot_heartbeats`                                          |
| `host/heartbeat/store.ts`          | 設定の保存（書き込みはここだけ。設計ルール 79）                            |
| `host/heartbeat/timing.ts`         | 次の発火時刻（純粋関数 `nextBeatAt`）、時間帯の判定（`withinActiveHours`） |
| `host/heartbeat/tasks.ts`          | `HEARTBEAT.md` が実質的に空かどうか（純粋関数 `heartbeatTasks`）           |
| `host/heartbeat/decide.ts`         | 送るか、見送るか、待つか（純粋関数 `decideBeat`）                          |
| `host/heartbeat/texts.ts`          | notice の本文（英語）                                                      |
| `host/heartbeat/file.ts`           | `HEARTBEAT.md` をボットの環境の fs で読む                                  |
| `host/heartbeat/heartbeats.ts`     | ボットごとの状態（タイマー、保留、直近の結果）と実行                       |
| `host/heartbeat/panel.ts`          | Web UI 向けの見え方と変更（Remote `botHeartbeat`）                         |
| `host/settings/areas/heartbeat.ts` | `bot_settings` の区画 `heartbeat`                                          |

- 時計は Host clock の決まり（ルール 26）に従い、`now()` / `later()` を deps で受け取る。

## 2. 設定

```ts
interface HeartbeatActiveHours {
  readonly start: string // "HH:MM"、ボットのタイムゾーン
  readonly end: string // "HH:MM"。start と同じにはできない。end < start なら日をまたぐ（22:00–06:00）
}

interface HeartbeatSettings {
  readonly enabled: boolean // 既定 true
  readonly intervalMinutes: number // 既定 180（3 時間）、5–1440（最短は schedule の every と同じ 5 分）
  readonly activeHours?: HeartbeatActiveHours // 無い = 一日中
}
```

- ボットごとの設定。dsh-bots 全体の既定値の画面は作らない（既定は定数 `DEFAULT_HEARTBEAT`）。
- 保存は新しいドメイン `dsh_bot_heartbeats`（version 1）、表 `settings`（キーはボット id）。記録の無いボットは既定値で動く。ボットを消すと記録も消す。
- 時間帯は `[start, end)`。終わりの時刻ちょうどは含まない。
- Web UI: ボットの設定に節 **Heartbeat**（order 160、Main セッションの次）。オン・オフ、間隔（分）、「決まった時間帯だけ」のスイッチと開始・終了の時刻、次の発火の予定と直近の結果（送った / やることが無かった / 時間帯の外で見送った）。
- `bot_settings` の区画 `heartbeat`（場所「ボットの設定 > Heartbeat」）: `enabled`（toggle）、`intervalMinutes`（integer 5–1440）、`activeHours`（text `HH:MM-HH:MM`、空で一日中）。どれも `free`（ボット自身の動き方で、オーナーに頼まれたときだけ変えられるのは §4 の決まりのまま）。保存は Web UI と同じ `panel.configure` を通る。

## 3. いつ発火するか

- 発火の時刻（スロット）は、ボットのタイムゾーンでの「その日の起点 + k × 間隔」。起点は時間帯があればその開始時刻、無ければ 0:00。スロットは起点から時間帯の長さ（無ければ 24 時間）の中だけで、日ごとに起点からやり直す。例: 30 分なら毎時 0 分と 30 分、時間帯 09:00–18:00 で 1440 分なら毎日 09:00。
- 最後の発火の時刻は保存しない。スロットは時計で決まるので、Host を再起動しても次のスロットで続く。止まっていた間のスロットは発火しない（待っているイベントは消えず、次のスロットで扱われる）。
- 夏時間で存在しない時刻のスロットは飛ばす。重なる時刻は早い方（dsh-util-time の `resolveLocalInstant`）。
- 設定・タイムゾーンの変更、ボットの作成と削除でタイマーを掛け直す。

## 4. 1 回の流れ

```
スロット
 └─ 保留にする（保留は 1 件だけ。既に保留ならそのまま = 溜まった回は 1 回にまとめる）
      └─ Main が idle になるまで待つ
           ├─ 時間帯の外になっていた → 保留を捨てる（結果: 時間帯の外）
           ├─ HEARTBEAT.md を読む（VM の fs）
           │    └─ 読めない（環境が無い、VM が止まっている、読み込みの失敗）→ 保留のまま待つ
           ├─ 待っているイベントを数え直す
           ├─ Main がまだ idle か確かめ直す → でなければ保留のまま待つ
           ├─ 送るものが無い → 保留を消す（結果: やることが無かった。モデルを呼ばない）
           └─ 送るものがある → notice（topic heartbeat）を outbox に入れ、保留を消す（結果: 送った）
```

- **実行中のターンには混ぜない**。発火のときに Main が動いていても、notice をその場で outbox に入れない。`next-turn` で後に積むだけでも混ざりはしないが、保留にして idle になってから条件を判定し直すことで、その間に Main が処理して送るものが無くなった回（オーナーとの会話の中でイベントを読んで ack した、など）にモデルを呼ばない。
- **Main が idle**: Main の Agent が `idle` で inbox（nextTurn / nextStep）が空（読み込まれていなければ idle とみなす）、Main の interaction（質問・承認・プランレビュー）が開いていない、そのボットの outbox に未配信の notice が無い、Main のメンテナンス（compaction・切り替え）が走っていない。Main の無いボットは idle でない。
- 保留を見直すきっかけ: Main の Agent が `idle` になった、interaction が変わった、ボットの環境（preset の版、fs の受け渡し、環境の状態）が変わった、次のスロット。ポーリングはしない。
- オフにしたら保留も捨てる。
- 読めないときに推測で送ったり見送ったりしない。heartbeat が VM を起こすこともしない（止まった VM は bot-vm の見回りが起こす）。環境が戻ったときにもう一度試す。

## 5. 送るかどうか（`decideBeat`）

送るのは次のどちらかがあるとき。どちらも無ければモデルを呼ばない。

- **待っているイベント**: 届け方が `queue` のコネクター（ボットで有効なもの）の、状態 `new` のイベント（取りこぼしの印 `gap` も 1 件と数える）。`notify` のコネクターは event の notice が届けるので数えない。
- **HEARTBEAT.md に中身がある**: 実質的に空でない。実質的に空とは、HTML コメント（`<!-- … -->`、複数行も）を除いたあと、どの行も次のどれかであること:
  - 空白だけの行
  - 見出し（ATX: 行頭 0–3 個の空白の後に `#` が 1–6 個、その後が空白か行末）
  - 空のリスト項目（`-` `*` `+` か `1.` `1)`、任意で `[ ]` `[x]`、その後に何も無い）
- ファイルが無いときも空として扱う（OpenClaw の新版の問題を繰り返さない）。ディレクトリなど通常のファイルでないものも無いとみなす。
- 16 KiB を超えるファイルは読み込まず、中身があるものとして扱う。notice には中身の代わりに「大きすぎるので自分で読んで短くする」と書く。

### 5.1 送信元ポリシーとの関係（docs/specs/bot-connectors.md §16）

- 数えるのは **ボットに見えるイベント** だけ。イベント一覧（`<connector>_events_list` / `_events_ack`）、notify の notice、設定画面の「未処理のイベント N 件」も同じ見え方を使う（`host/events/visibility.ts`）。heartbeat の件数とボットが一覧で見る件数は常に一致する。
- **保留されたメール**（`unknown=ask` の問い合わせで待っているもの）はイベントストアに入っていないので数えない。ボットは問い合わせに答えられない（答えるのは Web とチャネルのオーナー）ので、heartbeat で起こしても何もできない。問い合わせは今までどおりオーナーに出る。オーナーが許可すると保留していたイベントがストアに入り、次の回で数えられる。
- **溜まっている間にポリシーが厳しくなった** とき（拒否のルールを足した、`unknown` を聞く・隠すにした、ポリシーが消えた）: 送信元ポリシーは「聞く・隠すで過去のメールも見えなくなる」ので、まだ処理されていないイベントも見えなくする。そのためイベントの記録に、届いたときの送信元（`ConnectorEvent.sender`）を残し（`sender` は省略可の項目を足しただけ。`dsh_bot_connector_events` は version 1 のまま）、読むたびにその時点のポリシーで判定する。隠れたイベントは数えず、一覧に出さず、ack も受けない（ボットは ID を知らない）。消しはしないので、ポリシーを緩めれば戻り、戻らなければ未処理の保存期間（30 日）で消える。ポリシーが変わったら notify の届け方も見直す（見えるようになったものを知らせる）。
- 送信元を宣言しないコネクター（Google Calendar など）と取りこぼしの印（gap）は判定しない。送信元を宣言するコネクターのイベントで `sender` の無い記録（送信元ポリシーより前に溜まったもの）は、契約の定義どおり「送信元が読めない（`anonymous`）」として判定する。
- 届け方の初期値が `queue` になると、notify（1 分でまとめて知らせる）より長くイベントが溜まる。上の判定はそのために入れた。

## 6. HEARTBEAT.md

- ボットの workspace の直下、`AGENTS.md` / `SOUL.md` と同じ場所。ボット自身のファイルで、ボットが書き換える。
- Host は登録中の preset の版の files 行が渡した **ボットの環境の fs**（VM の fs）で読む。`AGENTS.md` を置くとき（`host/workspace-files.ts`）やノートと同じ道で、Host の fs は使わない。symlink は VM の中で辿る。
- **雛形**: 新しいボットには、`AGENTS.md` / `SOUL.md` と同じ規則（無ければ置く、あれば触らない、置いたら記録して以後は置かない）でコメントだけの `HEARTBEAT.md` を置く。コメントだけなので実質的に空で、置いてもモデルは呼ばれない。置く理由は、ボットとオーナーがファイルの役目と書き方を workspace で見つけられるようにするため。
  - 初期ファイルの版 `WORKSPACE_FILES_VERSION` を 2 に上げ、各ファイルに入った版を持たせる（`AGENTS.md` / `SOUL.md` は 1、`HEARTBEAT.md` は 2）。版 1 まで置いたボット（既にいるボット）には `HEARTBEAT.md` だけを置く。消された `AGENTS.md` / `SOUL.md` を置き直さない。

```markdown
# HEARTBEAT.md

<!--
Standing checks I run on my heartbeat, while my owner wants them.
Write each one as a short list item, for example:
- Check the build status page and tell my owner when it turns red.
Remove a check when it is no longer needed. Anything at a set time belongs in a schedule job instead.
While this file holds only headings and comments, the heartbeat does not wake me for it.
-->
```

## 7. notice

- 新しい topic `heartbeat`、配信タイミング `next-turn`、source `bot-heartbeat`（`form: "notice"`）。`dsh_bot_notices` は version 6（1–5 と互換）。
- 本文に外から来たもの（件名・送り主・要約）は入れない。待っているイベントは件数だけ（コネクターとアカウントごと）で、本文はツールで取得させる。`HEARTBEAT.md` はボット自身のファイルなので中身をそのまま入れる。

```text
[heartbeat] 2026-11-26T09:30:00+09:00
This is your periodic heartbeat, not a message from a person.
Connector events waiting for you:
- Gmail (alice@example.com): 3
- Google Calendar (alice@example.com): 1
HEARTBEAT.md:
<<<heartbeat-file
...
>>>heartbeat-file
- Read the waiting events with the matching _events_list tool (pass the account) and do what your owner would want with them.
- Then acknowledge every event you looked at with the matching _events_ack tool, the ones you chose to leave alone too: events you do not acknowledge bring the heartbeat back every time.
- Follow HEARTBEAT.md above.
- Do not bring back tasks from earlier conversations, and do not invent work.
- If there is nothing to tell your owner, end the turn with stay_silent instead of writing anything.
```

- イベントが無い回はイベントの行を、`HEARTBEAT.md` が空の回はファイルの行を出さない。summary（Web UI の 1 行）は `Heartbeat: 4 events waiting` / `Heartbeat: HEARTBEAT.md` / `Heartbeat: 4 events waiting, HEARTBEAT.md`。

## 8. 誰の入力か

- heartbeat の notice は「オーナー以外の入力」。`host/settings/authority.ts` の `OUTSIDE_INPUTS` は `NOTICE_SOURCES` から作るので `bot-heartbeat` が入る（heartbeat のターンでは `bot_settings change` を断る）。
- 管理しているセッションへの指示（`host/managed/authority.ts` の `OUTSIDE_SOURCES`）にも足す。heartbeat のターンは外から来たイベントを扱うので、コネクターのイベントの notice と同じ扱いにする。

## 9. Main の手入れとの関係（docs/specs/bot-main-rotation.md）

- heartbeat の notice もほかの notice と同じく入力ゲート（`MainController.admit`）を通り、普通のターンとして数える（`lastTurnAt` を進める）。
- 見送った回は Main に何も送らないので、活動に数えず、手入れ（アイドル compaction、日の切り替え、長い無操作）を妨げない。
- メンテナンス中は idle でないので、heartbeat は終わるまで待つ。

## 10. イベントの届け方の初期値

- `BotConnectorEvents.delivery`（コネクターが宣言する値）を「おすすめ」から **初期値** に変える。ボットでまだ設定していないコネクターは、この値で始まる。Web UI はこれまでもおすすめを表示していなかった。
- Gmail と Google Calendar の `delivery` を `notify` から `queue` にする。メールは 1 通ずつ Main に知らせるより、heartbeat でまとめて扱う方が向く。
- 既にあるボットは変えない。これまで記録に `events` が無いと `off` だったので、起動時に `events` の無い記録へ一度だけ `off` を書き込む（`timezone` を足したときと同じ）。以後の書き込みは必ず `events` を持つ（コネクターにイベントが無ければ `off`）。
- 画面には queue と heartbeat の組み合わせについての説明を出さない。

## 11. プロンプト（docs/specs/bot-system-prompt.md）

- `## This session`（Main）の notice の文に heartbeat を足し、`HEARTBEAT.md` の役目を 1 文で書く（定期の確認はそこ、決まった時刻のものは schedule のジョブ）。
- 初期の `AGENTS.md` の「Being proactive」に同じ趣旨の 1 行を足す（新しいボットだけ。置いた後のファイルは書き換えない）。

## 12. 範囲外

- dsh-bots 全体の既定値の画面。
- 手動で今すぐ発火させる操作。
- heartbeat を Main 以外のセッションで動かすこと。

## 実装で確定したこと

- **Remote** `botHeartbeat`（`watch(botId)`、`configure(botId, settings)`）。見え方 `BotHeartbeatView` は設定と状態（次の発火の予定、保留があるか、直近の結果）。`configure` は `parseHeartbeatSettings` で検査し、未知の項目を断る。
- **保存**: `dsh_bot_heartbeats` version 1、表 `settings`。書き込みは `host/heartbeat/store.ts` だけ（設計ルール 79 を足した。77 と 78 は送信元ポリシーとボットのグループが使う）。ボットを消すと消す。直近の結果と保留はメモリだけ（再起動で消え、次のスロットからやり直す）。
- **idle の判定**（`index.ts` の `mainIdle`）は §4 のとおり。見直しのきっかけは Main の Agent の `idle`、interaction の変化、Main のメンテナンスの状態の変化、環境（preset の版・fs の受け渡し・環境の状態）の変化、次のスロット。
- **読めないとき**は警告を残して保留のまま待つ。読み込みの上限は 30 秒。
- **初期ファイルの版**: `WORKSPACE_FILES_VERSION` を 2 に上げ、記録の `workspaceFiles` は `1 | 2`。`dsh_bots` は version 4（3 と互換。記録の値の型が広がったため）。`BotRegistry.hasWorkspaceFiles` は `workspaceFilesOf` に替えた。
- **届け方の確定**: `ConnectorSettings.migrateDeliveries()` を起動時に一度だけ（コネクターの設定の表を開いた直後）呼び、`events` の無い記録に `off` を書く。以後 `events` の無い記録を読むとエラーにする（推測で `off` にしない）。`configure` は渡された値、無ければ今の値、記録が無ければコネクターの初期値を必ず保存する。
- **プロンプト**: §11 の Main の文に加え、`## Your environment` の設定の一覧に `heartbeat` を足した。
- **確かめたこと**（動作確認用の DSH、偽の Google、実際のモデル）: 新しいボットに雛形の `HEARTBEAT.md` が置かれ（`workspaceFiles: 2`）、Gmail をオンにすると届け方は `queue` で保存された。何も無い回はモデルを呼ばずに「やることはありませんでした」になった。メールが 1 通溜まった回は notice（件数だけ）が届き、ボットが `gmail_events_list` で読み、`gmail_events_ack` で ack し、オーナーに伝えた。`HEARTBEAT.md` に確認を書いた回はボットが確かめて `stay_silent` を呼んだ。ファイルを空に戻した後の回はモデルを呼ばなかった。
- **送信元ポリシーとの確認**（rebase の後、新しいビルドで）: 未登録の送信元が「許可」のうちに届いたメールが送信元つきで `new` として溜まり、その後に「隠す」へ変えると、次の回は数えずにモデルを呼ばなかった（「やることはありませんでした」）。
- **確かめて分かったこと**: `stay_silent` を呼んだ後のステップでモデルが空の応答を返し、DSH がターンを `EMPTY_RESPONSE` で失敗にすることがあった（claude-subscription のプロバイダ）。heartbeat に限らない `stay_silent` の問題だったので、`stay_silent` の成功がそのターンを終えるようにして直した（docs/specs/bot-schedule.md §1）。§7 の notice の行も「書く代わりに stay_silent でターンを終える」に変えた。
