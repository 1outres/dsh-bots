# Main セッションの compaction と切り替え（ローテーション） 仕様

状態: `feat/main-rotation` で実装（末尾「実装で確定したこと」）。§9「記憶の書き出し」は `feat/main-memory-flush` で実装（参加者 `bot-core/memory-flush`）

## 目的

ボットの Main セッションは長く動き続ける。会話が途切れた機会に先に compaction し、区切りのよいときに
新しい Main に切り替えて、Main が肥大化しないようにする。

## 前提と配置

- 機能は **bot-core の中**（`host/mains/`）に置く。Main の記録（`BotRecord.mainSessionId`）、
  セッションの作成（設計ルール 1: `host/preset/session.ts` の `Bot.createSession`）、アーカイブ、
  チャネル・notice への入力はすべて bot-core の責務なので、別パッケージにしない。
- compaction の実行は DSH の `ctx.compaction.compactNow(agent, signal)`（アイドル時専用。実行中は
  `ManualCompactionError` の `busy`）。ボットのプリセットでは compaction が `compaction` グループに
  isolate されているので、Host の bot-core からは直接見えない。bot-core の新しい行
  `env-bot-core-compaction`（`@1outres/dsh-bot-core/compaction`）を **compaction を isolate しているグループの中**
  に置き、行がそのグループの `ctx.compaction` を、トークン付きで `bot` サービスに渡す
  （`env-bot-core-files` と同じ形）。
- 使用量は Host の `ctx.tokenMeter.contextPressure(session)`（`pressureTokens` / `contextWindow`）。
  token meter はテンプレートで isolate されていない Host のシングルトンなので、bot-core が optional に inject する。
- 時計は Host clock の決まり（ルール 26）に従い、`host/` は `now()` / `later()` を deps で受け取る。
- 判断（いつ compact / 切り替えるか）は純粋関数 `decideMain`（`host/mains/decide.ts`）。状態は
  ストア（`host/mains/store.ts`）、実行はコントローラ（`host/mains/controller.ts`）に分ける。

## 1. 用語

- **ターン終了時刻** `lastTurnAt`: 現 Main で最後に終わった通常のターンの `turn/end` の時刻。
  Main が作られてから一度もターンが無い間は無い（＝**未使用の Main**）。
  後述の「メンテナンスのターン」は数えない。
- **静かになった**: `now − lastTurnAt ≥ quietMinutes`。会話が途切れたとみなす。
- **アイドル**: Main の Agent が `idle`、inbox（nextTurn / nextStep）が空、Main の interaction（質問・承認・プランレビュー）が
  開いていない、bot-core の入力（チャネルのメッセージ、notice の受け渡し）が途中でない、メンテナンスが走っていない。
  Agent がまだ読み込まれていなければ再開して確かめる。
- **入力**: bot-core が Main に届けるもの。チャネルのメッセージと notice（connector / schedule / event）。
  Web UI で Main に直接書いたものは DSH の composer から届くので bot-core は事前に止められない（下の制約）。

## 2. 設定

dsh-bots 全体の設定に既定値、ボットごとの設定で項目単位に上書きする。

```ts
interface MainRotationSettings {
  readonly quietMinutes: number // 会話が途切れたとみなす無操作の時間。既定 10、1–1440
  readonly idleCompaction: { readonly enabled: boolean; readonly minUsagePercent: number } // 既定 true, 50（1–100）
  readonly daily: { readonly enabled: boolean; readonly time: string } // 既定 true, "04:00"（HH:MM、ボットのタイムゾーン）
  readonly longIdle: { readonly enabled: boolean; readonly minutes: number } // 既定 true, 360（1–43200）
  readonly compactions: { readonly enabled: boolean; readonly count: number } // 既定 true, 3（1–100）
  readonly memoryFlush: { readonly enabled: boolean } // 記憶の書き出し（§9）。既定 true
}
// ボットごと: 各項目を省略すると既定に従う
type MainRotationOverride = {
  readonly quietMinutes?: number
  readonly idleCompaction?: Partial<MainRotationSettings["idleCompaction"]>
  readonly daily?: Partial<MainRotationSettings["daily"]>
  readonly longIdle?: Partial<MainRotationSettings["longIdle"]>
  readonly compactions?: Partial<MainRotationSettings["compactions"]>
  readonly memoryFlush?: Partial<MainRotationSettings["memoryFlush"]>
}
```

- 有効な設定 = 既定値に上書きを項目ごとに重ねたもの（`effectiveSettings`、純粋関数）。
- オーナーの操作（`/new`、Web UI のボタン）は設定でオフにしない（明示の操作なので）。
- 保存は新しいストレージドメイン `dsh_bot_mains`（version 2。version 1 に `memoryFlush` を足した）: `settings`（キー `defaults`）、
  `overrides`（ボット id）、`activity`（ボット id）。書き込みは `host/mains/store.ts` だけ（設計ルール 52）。

## 3. 判断（`decideMain`）

入力: 現在時刻、有効な設定、Main の事実（開始時刻、`lastTurnAt`、compaction 回数、使用率、
アイドル compaction 済みの `lastTurnAt`）、日の境目（Main 開始後の最初の `daily.time`）、きっかけ（`tick` / `input`）。
出力: `rotate(reason)` / `compact` / `wait(until?)`。日の境目は「Main の最初のターンの後の最初の `daily.time`」。アイドルかどうかは判断に含めない（コントローラが確かめる）。

`tick`（ターン終了、Agent が idle になった、タイマー、設定変更、起動時）:

1. 未使用の Main なら何もしない（次のターン終了まで待つ）。
2. 静かになっていなければ `wait(lastTurnAt + quiet)`。
3. `daily` が有効で、日の境目 ≤ 現在 → `rotate("daily")`。
4. `compactions` が有効で、回数 ≥ `count` → `rotate("compactions")`。
5. `idleCompaction` が有効で、使用率 ≥ `minUsagePercent`、この `lastTurnAt` でまだ試していない →
   その compaction で回数が `count` に届く（`compactions` 有効）なら compaction せずに `rotate("compactions")`、
   そうでなければ `compact`。
6. それ以外は `wait(日の境目)`（`daily` が有効で境目が未来のとき）、または `wait()`。

`input`（入力を届ける直前）: 上の 1, 3, 4（静かになっていることも条件）に加えて、
`longIdle` が有効で `now − lastTurnAt ≥ minutes` → `rotate("long-idle")`。compaction はしない（入力を待たせない）。

境界ケース:

- **日の切り替わり**は「Main の最初のターンの後に境目が来たか」で見るので、1 日に 1 回だけ。境目の時刻に作業中、
  または静かになっていないなら、次に静かになってアイドルになったときに切り替える。
  境目の前に `/new` で作った Main も、境目の後に使っていれば切り替える。未使用なら切り替えない。
- 日の境目はボットのタイムゾーン（`BotView.timezone`）で `daily.time` を cron（`MM HH * * *`）として DSH の `Cron` で求める。
  夏時間で存在しない時刻は飛ばし、重なる時刻は早い方（`Cron.next` の規則）。
- **使用率**は Agent が読み込まれているときだけ分かる（`contextPressure` は最後のリクエストの値）。
  分からないときは compaction しない。compaction 後の使用率は次のリクエストまで変わらないので、
  同じ `lastTurnAt` では一度しか試さない（失敗・何もできなかった場合も）。
- **compaction 回数**は Main のセッションログから数える（純粋関数 `countCompactions`）:
  `compaction/start` から `compaction/end` までの括りで、`compaction/summary` があり、`end` に `error` が無いもの。
  ターン途中の自動 compaction とアイドル compaction の両方が数わる。tool-result の刈り込みだけで終わったもの（summary 無し）は数えない。
  数はターン終了と `compaction/end` のたびに数え直してストアに残す（Agent が読み込まれていない間の判断用）。
- 未使用の Main は「長い無操作」「回数」でも切り替えない（空の Main が増えるだけなので）。

## 4. 実行の流れ（決める → 準備 → 実行）

```
決める (decideMain) → アイドルを確かめる → 準備 (MainPreparation 参加者: 記憶の書き出し、§9) → アイドルを確かめ直す → 実行
```

- ボットごとに同時に 1 つだけ（メンテナンスのロック）。入力の受け渡しとは排他で、入力が途中ならメンテナンスを始めない。
  メンテナンス中に届いた入力は終わるまで待ち、その後に**その時点の** Main（切り替えたなら新しい Main）へ届く。
- 準備の参加者がどれか失敗する・時間切れになる・アイドルでなくなったら、実行しない（compact も切り替えもしない）。
  `tick` のものは次の判断の機会にまた決める。入力によるものは、その入力を今の Main に届ける。`/new` は失敗を返す。

### compaction の実行

- `compactNow(agent, signal)`（signal はメンテナンスの上限時間で切れる）。結果が null（縮められる範囲が無い）、
  `busy`、その他の失敗は警告だけ残し、この `lastTurnAt` では再試行しない。

### 切り替えの実行

1. `Bot.createSession(botId, { title: bot.name })` で新しい Main を作る（ボットのプリセット、環境の workspace）。
2. レジストリの書き込みキューで、Main がまだ旧 Main であることを確かめてから、旧 Main のセッション記録に
   `retiredMain: { endedAt, reason }` を書き、ボット記録の `mainSessionId` を新 Main にする。
   ここで Main ガードは旧 Main を守らなくなる（ガードは現 Main だけを守る）。
3. 旧 Main を `archiveSession(旧, { stopActivity: true })` でアーカイブする。失敗しても切り替えは済んでいる（警告）。
4. 活動の記録を新 Main に合わせて空にする。notice の配信を新 Main に対して一度回す。
5. 新 Main はあいさつせず、ターンも走らせない（深夜に勝手に投稿しないため。新 Main ではモデルも呼ばない。旧 Main の記憶の書き出し（§9）は切り替えの前）。最初の入力までターンの無い
   未使用の Main のままで、Web UI からはすぐ書ける（「実装で確定したこと」）。
   AGENTS.md / SOUL.md はシステムプロンプトに従来どおり入り、notes/ などは必要に応じて自分で読む。旧 Main の要約やメモは渡さない。

### 切り替えで向き先が変わるもの（`mainSessionOf` などの洗い出し）

すべて「ボット id → その時点の `mainSessionId`」を毎回引くので、記録を変えれば新 Main に向く:

| 箇所                                                          | 振る舞い                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| チャネルの入力（`host/channels/conversation.ts`）             | 入力ゲートを通り、届ける直前に Main を引く                                               |
| チャネルの出力（`host/channels/feed.ts` `botOfMainSession`）  | 新 Main のイベントだけが流れる。旧 Main はアーカイブされ何も出ない                       |
| コマンド（`/stop` `/status` `/new`）                          | その時点の Main                                                                          |
| notice outbox（`host/notices/delivery.ts`）                   | 入力ゲートを通る。旧 Main に渡したが記録されていないものは、新 Main に同じ id で送り直す |
| schedule の `main` モード                                     | notice outbox 経由なので上と同じ。`schedule` ツールの呼び出し元判定もその時点の Main     |
| コネクター（`sessions: "main"`、呼び出し元の `main` / `bot`） | その時点の Main                                                                          |
| `stay_silent` / present（チャネルへのファイル）               | その時点の Main のものだけが届く                                                         |
| interaction の「Main」（`InteractionPlace.main`）             | 開いている間は切り替えないので、新 Main で開いたものだけが Main のもの                   |
| プロンプトのセッション種別（`host/prompt/session-kind.ts`）   | 現 Main は `main`、過去の Main を復元して書くと `web` 扱い                               |
| Main ガード（`host/main.ts`）                                 | 現 Main だけを守る                                                                       |

## 5. きっかけごとの振る舞い

- **アイドル compaction**: 静かになってアイドル、使用率 ≥ X% → 裏で compaction。ターン途中の DSH の自動 compaction はそのまま（保険）。
- **日の切り替わり**: 上記。
- **長い無操作のあと**: 入力が届いたとき、静かになっていて `now − lastTurnAt ≥ longIdle` なら、入力を届ける前に切り替え、
  入力は新しい Main に届ける。
- **compaction が N 回**: 静かになってアイドルのとき。
- **オーナーの操作**: チャネルの `/new` と Web UI（ボットのメニュー「新しい Main セッションを始める」、設定の Main セッション）。
  アイドルでなければ断る（「処理中か、質問・承認が開いています。/stop するか終わってから」）。未使用の Main なら何もしない（`unchanged`）。
  チャネルの `/new` はオーナーだけ（チャネルの owners 欄）。応答はコマンドの結果としてチャネルに
  「新しい Main セッションを始めました」と出す（Main のターンではない）。

## 6. 契約の変更

### チャネル契約

- `BotCommandId` に `"new"` を足す。`BotCommandSpec.access: "anyone" | "owners"`（`new` は `owners`）。
  `owners` のコマンドを宣言するチャネルは `owners` 欄を持たなければならない（宣言の検査で断る）。
- `BotChannelLink.run(command, person)`: 実行した人のチャネルでの id を渡す。`owners` のコマンドは owners 欄にいる人だけ。
- `BotCommandResult` に `{ command: "new"; outcome: "started" | "unchanged" }`。断るときは `{ ok: false, message }`。

### bots

- `BotView.mainStartedAt`（現 Main になった時刻）。過去の Main は `BotView.sessionIds` に入る（Main 以外のセッションが
  加わった順。過去の Main は切り替えられた時点で加わるので、名前の無いセッションの「New session N」の番号は変わらない）。
- `BotView.formerMainIds`: `sessionIds` のうち過去の Main（管理セッションにできない。docs/specs/bot-managed-sessions.md §4。メニューに管理の項目を出さないためだけに使う）。
- `MainRotationReason = "daily" | "long-idle" | "compactions" | "owner"`（Host の `retiredMain` の記録に使う）。
- `dsh_bots` の `sessions` に省略可の `retiredMain` を足す（互換、version はそのまま）。

### Remote `botMains`

```ts
interface BotMainsApi {
  watchDefaults(signal?): AsyncIterable<MainRotationSettings>
  setDefaults(settings: MainRotationSettings): Promise<MainRotationSettings>
  watch(botId: string, signal?): AsyncIterable<BotMainsView> // defaults / override / effective / status
  configure(botId: string, override: MainRotationOverride): Promise<BotMainsView>
  startNew(botId: string): Promise<MainRotationOutcome>
}
type MainRotationOutcome =
  | { readonly outcome: "started"; readonly sessionId: string }
  | { readonly outcome: "unchanged" }
  | {
      readonly outcome: "refused"
      readonly reason: "busy" | "preparation-failed" | "not-ready"
      readonly message: string
    }
```

## 7. Web UI

- dsh-bots 設定に「Main セッション」節（既定値）、ボットの設定に「Main セッション」節（項目ごとに「既定に従う」か値、
  現在の Main の開始時刻・compaction 回数、「新しい Main を始める」ボタン）。
- ボットのメニューに「新しい Main セッションを始める」。
- ツリー: 過去の Main は特別に扱わない。アーカイブ済みのセッションとして他のセッションと同じ場所に、同じ見た目と
  名前の付け方（タイトル。作成時に付けたボットの名前）で並び、ボットの「アーカイブ済みを表示」のときだけ見える。
  見るときは他のセッションと同じく「復元」してから開く。復元しても Main には戻らない（チャネルや notice は届かない）。

## 8. 制約

- Web UI で Main に直接書いた入力は「長い無操作のあと」の切り替えの対象にならない（DSH の composer は bot-core を通らず、
  `agent/inbox/inserted` は止められない通知なので）。その場合は旧 Main で会話が続き、次の判断の機会に他のきっかけで切り替わる。
- ターン途中に圧迫で走る DSH の自動 compaction（保険）には準備（記憶の書き出し）を挟めない。
- 待っているコネクターの承認（connector action）は切り替えを止めない（何日も待つことがあるため）。
  決まった結果は notice として新しい Main に届く（notice の本文はそれだけで読める）。

## 9. 記憶の書き出し（実装済み）

compaction や切り替えの直前に、Main に「このセッションで今後も覚えておくことをノートに書いてください」と頼む
1 ターン（記憶の書き出し）を挟み、終わってから compaction / 切り替えを行う。長期記憶はボットの workspace の
`notes/`（docs/specs/bot-notes.md）で、書き出しはそのツール `note_write`（`create` / `update` / `append`）、
`note_link`、`note_read` / `note_search` で行う。拡張点と `runTurn` は `feat/main-rotation` で、参加者は
`feat/main-memory-flush` で実装した（末尾「実装で確定したこと」の「記憶の書き出し」）。

### 新しい Main が notes から自動で受け取るもの

旧 Main の要約やメモは渡さない（§4）。新 Main が何もしなくても持っているのは次だけで、それ以外は自分で `note_search` / `note_read` する。

- システムプロンプトの AGENTS.md と SOUL.md、notes の使い方の節（`## Memory`、bot-notes.md §8）。
- コンテキスト `bot:pinned-notes`: `pinned: true` のノート（初期の `Owner` と `Now` など）の本文を毎ステップ入れる（bot-notes.md §6、§11.5）。
  書き出しで `Now` などのピン留めノートを今の状態に書き直しておけば、新 Main は最初のターンからそれを読む。
- 発言に出た語の知らせ（bot-notes.md §5）: 新 Main で既存ノートの名前が出れば、その発言の直後に候補が届く。
- デイリーノートや個々のノートの本文は自動では入らない。

### 参加者（記憶の書き出し）

- `order` の小さい参加者として登録し、`maintenance` が `compact` でも `rotate` でも、`runTurn` で次のような 1 ターンを頼む
  （英語のプロンプトの要旨）: 「この会話はまもなく compaction される / 新しい Main に引き継がれる。まだノートに書いていない、
  後でも要ることを書いておくこと: 人・場所・用件などはそのもののノートに `note_write` で今の状態として、今日の出来事は今日のデイリーノートに
  `append` で、進行中のことは `Now` に。書いたら候補のリンクを `note_link` で確かめる。書くことが無ければ何も書かない。返事は短く。」
- このターンは Main の中で、オーナーとの会話の続きとしてボット自身が判断して書くので、ピン留めノートを書き換えてよい
  （bot-notes.md §7 の「オーナーとの会話の中でのボット自身の判断」に当たる）。外から来た情報を書くときは出どころを書く決まりもそのまま。
- `runTurn` の結果が `completed` でなければ reject して今回のメンテナンスを見送る（ノートに書けないまま要約や切り替えをしない）。
  書き出しのターン自体がノートを書くのでコンテキストが少し増えるが、その後の compaction / 切り替えで消える。
- 同じ無操作の区間で compaction の書き出しをした後に切り替えが続く場合（§3 の 5. で回数に届くなら切り替えになる）でも、
  書き出しは毎回頼む（2 回目は書くことが無ければ何も書かない）。
- ボットごとの設定 `memoryFlush.enabled`（§2。既定オン）でオフにできる。オフのときは参加者が何もせずに resolve し、メンテナンスはそのまま進む。

### 拡張点（`mains-contract.ts`、`bot` サービス経由）

```ts
type MainMaintenance =
  | { readonly kind: "compact" }
  | { readonly kind: "rotate"; readonly reason: MainRotationReason }

interface MainPreparationRequest {
  readonly bot: { readonly id: string; readonly name: string }
  readonly sessionId: string // 今の Main
  readonly maintenance: MainMaintenance
  /** 入力を保留しているか（長い無操作のあとの切り替え）。 */
  readonly holdingInput: boolean
  readonly signal: AbortSignal // メンテナンスの上限時間、アンロードで切れる
  /**
   * Main にメンテナンスのターンを 1 回走らせ、終わって Agent がそのターンを離れる（idle になるか次のターンを始める）まで待つ。
   * チャネルには何も出さず（返答もターン状態も）、ユーザーの活動に数えない（lastTurnAt を進めない）。
   */
  runTurn(prompt: { readonly text: string; readonly summary: string }): Promise<MainTurnResult>
}
type MainTurnResult =
  | { readonly ended: "completed" }
  | { readonly ended: "failed" | "cancelled"; readonly message: string }

interface MainPreparation {
  readonly id: string // 重複は登録で断る
  readonly order: number // 小さい順に 1 つずつ
  /** 失敗（reject）すると、今回のメンテナンスは実行しない。 */
  prepare(request: MainPreparationRequest): Promise<void>
}

interface Bot {
  registerMainPreparation(preparation: MainPreparation): () => void
}
```

- 登録できるのは `bot` サービスを inject するプラグイン（bot-core 内のモジュールも、別パッケージの記憶プラグインも）。
  `bot` サービスの公開メソッドなので、別パッケージはこれまでどおり `botOf(ctx)` で登録し、effect で解除する。
- 準備の後にアイドルを確かめ直してから実行する（`runTurn` のターンが終わった後、入力が来ていたり質問が開いていたら実行しない）。
- メンテナンスのターンは `bot-main` の notice（`source: { kind: "bot-main", form: "notice", summary }`）として followup で送る。
  そのターンの間、チャネルへの出力（返答もターン状態も）は止める。`lastTurnAt` も進めない。
- **長い無操作のあとの切り替え**では、届いた入力を準備の間保留する。順序: 入力の到着 → 判断 → 準備（書き出しのターン）→
  確かめ直し → 切り替え → 保留していた入力を新しい Main へ。準備の上限時間（`MAIN_MAINTENANCE_LIMIT_MS`、5 分）を超えたら
  signal を切り、切り替えずに入力を今の Main に届ける。保留中に届いた後続の入力は、到着順に同じく待つ。
- ターン途中の自動 compaction には書き出しを挟めない（上の制約）。

## 実装で確定したこと

- **日の境目の起点**: 「Main の開始後」ではなく「Main の最初のターンの終わり（`firstTurnAt`）の後の最初の `daily.time`」にした。
  境目の直前に作られ、境目の後に初めて使われた Main（会話がすべて境目の後）を切り替えないため。
- **新 Main に開始ターンは無い**: DSH の hero は、どの Workspace にも属さない空のセッションの composer を無効にする
  （「Choose workspace」。dsh-client-ui-conversation `ConversationContent` の `inert = hero && Workspace 無し`）。
  ボットのセッションは Workspace に属さないので、bot-core のシェルは空のボットのセッションの `conversation.content` を
  `hero: false`・`active` で描き、composer をそのまま使えるようにする（README「Blank sessions」）。準備中の表示は
  準備中のセッション（`BotsSnapshot.preparingSessionIds`: 新しいセッションは環境が応答するまで、新しいボットの Main は
  あいさつを送るまで）だけ。新 Main も他の新しいセッションと同じく環境の確認だけを待つ（動いている VM ではすぐ終わる）。
  そのため新 Main にはターンを走らせず、新 Main ではモデルは呼ばれない（呼ばれるのは切り替えの前の旧 Main の記憶の書き出し、§9 だけ）。保留した入力（長い無操作のあとの最初の入力）や
  Web UI から書いた入力が新 Main の最初のターンになる。以前は設定 `mainOpening` の「Ready.」と返すだけのターンを走らせていた（削除）。
- **活動の記録と判断の順序**: `turn/end` の直後に Agent の `idle` が来るので、ターン終了の記録が保存されるまで判断しない
  （コントローラの `writing`）。動作確認で、保存前の古い `lastTurnAt` でアイドル compaction が直後に走る競合を見つけて直した。
- **使用率**: `tokenMeter.contextPressure` の `pressureTokens`（最後のリクエストのプロンプトの大きさ。出力は含まない）/
  `contextWindow`。1M トークンのモデルでは 1% が約 1 万トークン。
- **再試行**: 実行しなかったメンテナンス（準備の失敗、作成できない、失敗）は 5 分後、以後倍々で最大 2 時間まで次を試さない
  （新しい通常のターンが終わると解除）。`busy` 以外は警告を残す。オーナーの `/new` は再試行の間隔を作らない。
- **compaction 行の位置**: テンプレートの行のうち `isolate.compaction: true` のグループの末尾。無ければ `bot-environment` グループの
  bot-core の行の並び（その realm の compaction がボットの Agent のもの）。2 つ以上のグループが compaction を isolate する合成は断る。
  設計ルール 8 の例外に `plugins/compaction.ts` を足した（その realm の `compaction` を名前で読む）。
- **ストレージ**: `dsh_bot_mains` version 1（`settings` / `overrides` / `activity`。記憶の書き出しで version 2、下記）。書き込みは `host/mains/store.ts` だけ
  （設計ルール 52、受け手の名前 `mainSettings` / `mainOverrides` / `mainActivity`）。初回起動で既定値を保存し、以後は保存値だけを読む。
  `dsh_bots` の `sessions` に省略可の `retiredMain`（互換、snapshot 更新）。
- **入力ゲート**: `MainController.admit(botId, work)`。チャネルの `deliver`（添付の保存と `session.prompt` まで）と notice の受け渡しが通る。
  メンテナンス中・活動の保存中は待ち、入力が途中の間はメンテナンスを始めない。
- **`/new` の宣言**: `BotCommandSpec.access` を足し、`new` は `owners`。`BotChannelLink.run(command, person)`。
  owners 欄の無いチャネルが `new` を宣言すると `registerChannel` で断る。Discord は `/new` を DM のスラッシュコマンドとして足した
  （`allowed` の人でも `approvers` に居なければ断る）。
- **過去の Main の表示**: 以前はツリーの Main の下に「Show N past Mains」の行と「Past Main · 開始 – 終了」の名前があったが、
  なくした（`BotView.pastMains` / `BotPastMain` も削除）。過去の Main は `BotView.sessionIds` のアーカイブ済みセッションとして並ぶ。
  クラシフィケーションとセッションメニューは `sessionsOfBot`（Main と `sessionIds`）で過去の Main も含む。
- **新 Main のモデル**（docs/specs/bot-models.md）: 新しい Main も BOT の作成時の Main と同じ `createMainSession` で作る。
  `Bot.createSession` が `main` ロールのモデルで Agent を作り、作成に使った `main` で `mainPending` を下ろす。作成中に `main` が変えられたときは
  `replaceMain` の直後にもう一度適用する（最初の入力の前）。モデルの記録はボット単位で、Main かどうかはその時点の `mainSessionId` で決まるので、
  過去の Main を復元して読み込んでも `main` は適用されない。新 Main の最初のターンは新 Main のモデル（`main`）で走る。
- **既定値**: `quietMinutes` 10、アイドル compaction 50%、毎日 04:00、長い無操作 360 分、compaction 3 回。
- **確認で分かった制約**: Web UI で Main に直接書いた入力は「長い無操作」の対象外（§8）。
- **記憶の書き出し**（§9、`feat/main-memory-flush`）:
  - 参加者は bot-core の `host/notes/flush.ts`（`createMemoryFlush`、id `bot-core/memory-flush`、order 0）。ノートの仕組みと同じく
    bot-core の責務なので、別パッケージにしない。`index.ts` が `registerMainPreparation` と同じ登録先に effect で登録する。
  - プロンプトは英語で `host/notes/texts.ts` の `memoryFlushPrompt(maintenance)`。`compact` は「まもなく compaction され、古い部分は要約に
    置き換わる」、`rotate` は「まもなく終わり、新しい Main がこの会話なしで引き継ぐ（ピン留めノートと自分で調べるノートから始める）」と
    出し分け、切り替えの理由（daily / long-idle / compactions / owner）では変えない。続けて、人・場所・組織・用件・ものはそのもののノートに
    `note_write` で今の状態として、今日の出来事は今日のデイリーノートに `append` で、進行中のこと・近い予定・約束はピン留めの Now に、
    書いたら候補のリンクを `note_link` で確かめる、外から来た事実は出どころを書く（bot-notes.md §7）、書くことが無ければ何も書かない、
    今は誰にも質問しない（開いた質問はメンテナンスを止めるため）、返事はどこにも出ないので 1 行で、と頼む。Web UI に出る要約は `Memory write-out before compaction` / `Memory write-out before a new Main`。
  - `runTurn` の結果が `completed` でなければ `the memory write-out turn <failed|cancelled>: <理由>` で reject し、今回のメンテナンスは
    見送る（再試行の間隔は他の準備の失敗と同じ。オーナーの `/new` は `preparation-failed` で断る）。メンテナンスの上限時間で signal が切れたら、
    ターンの終わりを待たずに reject する（ターン自体は止めない。そのターンの出力はチャネルに出ないまま）。
  - **`runTurn` の終わり**: DSH の Agent は `turn/end` を記録した後、ドライバーが非同期に抜けてから `idle` になる
    （dsh-agent-loop の `kick`）。`turn/end` の時点で解決すると、準備の後のアイドルの確かめ直しがまだ `running` の Agent を見て断りうるので、
    `host/mains/turns.ts` は `turn/end` の後、Agent の `agent/status` が `idle` になったとき（または次のターンが始まったとき）に解決する。
    前のメンテナンスのターン（時間切れで見送ったもの）がまだ走っている Main では、`runTurn` は Main に何も送らずに reject する
    （印の無いターンがチャネルに出ないように）。
  - **設定**: `MainRotationSettings.memoryFlush: { enabled }`（既定 true）、ボットごとに `memoryFlush.enabled` で上書き。`dsh_bot_mains` は
    version 2（`compatibleVersions: [1]`）。保存値の `memoryFlush` は省略可（version 1 の既定値の行には無い）で、ストアを開くときに無ければ
    既定（オン）を足して保存し直す。以後は保存値だけを読む。`MAINS_DOMAIN` を設計ルール 27 のスナップショットに加えた。
  - **Web UI**: dsh-bots 設定とボットの設定の「Main セッション」節の末尾に「記憶」グループ（「compaction や新しい Main の前にノートへ書き出す」の
    スイッチ。ボットでは他の項目と同じく「既定に従う」か個別）。
