# ボットの Main の入力欄（Main composer） 仕様

状態: `feat/main-composer` で実装。

## 目的

ボットの **Main セッション** の画面では、DSH の composer（`conversation.composer.bar`）の代わりに bot-core の入力欄を出す。
Web UI から書いたものは DSH の composer からセッションへ直接入るのではなく、**チャネルのメッセージと同じ道（bot-core の入力ゲート）** を通って Main に届く。

- composer の下の統計（ターン数・ステップ数・tok/s、トークン数・キャッシュヒット率）とコンテキストのメーター（「4%」）を出さない。
- `/`（コマンド・スキル）と `@`（ファイル・セッションの参照）のメニューを出さない。Main ではスラッシュコマンドを使わない。
- 画像とファイルを添付できる（選択・貼り付け・ドロップ）。
- 入力ゲート（`MainController.admit`）を通るので、「長い無操作のあと」の切り替えなど Main の判断が Web の入力の前にも働く（docs/specs/bot-main-rotation.md §8 の制約を解消）。

## 1. 範囲

- 対象は **現在の Main**（`BotView.mainSessionId`）を Web UI のメインの表示で開いているときだけ（`showsCurrentMain`）。
  ボットの他のセッション、復元した過去の Main、管理しているワークスペースのセッションは DSH の composer のまま。
- ボットの他のセッションでは、これまでどおり DSH の composer のモデル・権限の席を空にする（`client/wiring/composer-seats.ts`）。Main では bar ごと置き換わるのでその席は描かれない。
- Interaction composer（質問・承認・プランレビュー、`conversation.composer` の chain）は変えない。chain が選んだときは DSH の Factory が bar ごと（この入力欄も）隠すので、従来どおり Interaction composer が優先される。
- DSH の `conversation.input.dock`（Main の inbox に溜まったメッセージの QueueDock、ゴール）は bar の外にあるので、そのまま出る。

## 2. コントラクト（`shared/main-input.ts`、Remote `botMainInput`）

```ts
interface BotMainInputApi {
  watch(botId, signal?): AsyncIterable<MainInputState>
  stage(botId, request: { draft; name; mediaType?; bytes }): Promise<MainStageResult>
  append(botId, attachmentId, offset: number, data: string /* base64 */): Promise<MainAppendResult>
  discard(botId, attachmentId): Promise<{ discarded: boolean }>
  send(botId, submission: { text; attachments: readonly string[] }): Promise<MainSendResult>
  stop(botId): Promise<MainStopResult>
}
interface MainInputState {
  botId
  mainSessionId?
  activity: "idle" | "running"
  limits: {
    maxCount
    maxFileBytes
    maxMessageBytes
    chunkBytes
    images?: { mediaTypes; maxImageBytes; maxImagesPerMessage; maxMessageImageBytes }
  }
}
type MainSendResult =
  | { sent: true; sessionId; mode: "queue" | "steer" }
  | { sent: false; failure: MainInputFailure }
```

- 呼び出し元は DSH のオーナー（`invocation.peer.principal.kind === "owner"`）だけ。それ以外は `not-owner`（`watch` は失敗する）。リストに無いボットは `unknown-bot`。
- 失敗のコード `MainInputFailureCode` はチャネルの `BotDeliveryFailureCode` に `not-owner` / `unknown-bot` / `unknown-attachment` / `incomplete-attachment` を足したもの。
- `watch` は Main が替わったとき（レジストリの変更）と Main の Agent の `agent/status` で流れる。

### 添付の受け渡し（ステージング）

ゲートウェイの uplink は流量制御が無く 256 KiB で溢れるので、添付は **単発の呼び出しを分けて** 送る。

1. 選んだ（貼った・落とした）時点で `stage` する。`draft` は入力欄の下書きごとの id（送るたびに新しくする）。Host は、同じ下書きにすでにステージしてあるものと合わせて（再読み込みや別のタブが残したものは数えない）、チャネルの添付と同じ規則
   （`planAttachments`: 個数・ファイル・画像・1 通の合計、画像は DSH の `attachments.imageLimits`）で申告の大きさを確かめ、だめならその場で断る。
2. `append` で `chunkBytes`（512 KiB）ずつ順に送る。`offset` が受け取った量と違う、申告より大きい、チャンクが大きすぎるものは断る。
3. `send` が添付の id を挙げる。全部そろっていなければ `incomplete-attachment` / `unknown-attachment`。届けられたら Host はそれらを捨てる。
   届けられなかったときは残すので、そのまま送り直せる。
4. 外した添付は `discard`。触られないまま 1 時間（`MAIN_INPUT_STAGING_TTL_MS`）たったものは次の操作のときに捨てる（`host/main-input/staging.ts`、純粋な遷移 `stageIn` / `appendIn` / `resolveIn` / `sweep` とそれを持つストア）。

- ステージは Host のメモリだけ（ボットごとに 1 通の上限まで）。DSH を再起動すると消える。

## 3. Host の道（チャネルと同じ）

`host/channels/delivery.ts` の `deliverToMain` をチャネル（`host/channels/conversation.ts`）と Web（`host/main-input/panel.ts`）の両方が使う。

```
入力ゲート（mains.admit: メンテナンス・長い無操作の切り替えの判断）→ その時点の Main → vault の shield（inbound-message）
→ composePrompt（画像は画像の部分、ファイルはボットの環境の .inbox/<時刻>-<出どころ>/ に保存して「Attached files, saved in your workspace:」の段落）
→ sessionController.prompt（idle なら queue、実行中は DSH の busy Enter の設定: queue / steer）
```

- 出どころ（`MainInputSource`）: チャネルは `{ id: channelId, attachments: そのチャネルの能力 }` とヘッダ行、Web は `{ id: "web", attachments: { maxCount, maxBytes: maxFileBytes } }` で **ヘッダ行なし**。
  ボットのプロンプトの「ヘッダの無いメッセージは Web UI のオーナーが書いたもの」（`host/prompt/texts.ts`）がそのまま当てはまり、Main のタイムラインでも経路「Web UI」のオーナーとして出る。
- 本文が空で添付が画像だけのときは text の部分を付けない（ヘッダも無いため）。
- 停止は `stop` → チャネルの `/stop` と同じコマンド（`createCommandRunner` の `stop`: 実行中なら `sessionController.cancel`）。
- 実行中の送信: チャネルと同じく busy Enter の設定の mode で届ける。queue なら DSH の inbox（nextTurn）に入り、DSH の QueueDock に出て、今のターンの後に読まれる。steer なら次のステップで読まれる。
- 設定（busy Enter）と画像の上限の読み取り、コマンド、配送は `credentials` を待たずに Host の起動時に用意する（チャネルの接続だけが `credentials` を待つ）。

## 4. Main のタイムライン

- Web から届いたメッセージは header の無い `user` メッセージなので、`personTextOf`（`host/main-view/origin.ts`）が作者 `web` とし、
  末尾の「Attached files, saved in your workspace:」の段落を添付ファイルに変換する（以前はヘッダのあるチャネルのメッセージだけ）。画像は `image` ブロックのまま。

## 5. Client

| ファイル                             | 役割                                                                                                                                                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/main-input/client.ts`        | Remote の薄い包み                                                                                                                                                             |
| `client/main-input/draft.ts`         | 下書き（本文・添付とその状態）の純粋な遷移、`sendableOf`                                                                                                                      |
| `client/main-input/state.ts`         | 入力欄の状態（接続・下書き・送信中・停止中・お知らせ）の純粋な遷移、`availabilityOf`、`primaryActionOf`                                                                       |
| `client/main-input/keys.ts`          | Enter の判定 `keyIntent`（IME の変換中 `isComposing` / keyCode 229 では送らない。Shift / Alt / Ctrl / Meta + Enter は改行）                                                   |
| `client/main-input/uploads.ts`       | `stage` → `append` の分割送信、途中で断られたら `discard`                                                                                                                     |
| `client/main-input/model.ts`         | ボットごとのモデル。購読がある間だけ `watch` を追う（`followStream` で再接続）                                                                                                |
| `client/main-input/MainComposer.tsx` | 描画                                                                                                                                                                          |
| `client/wiring/main-composer.ts`     | `conversation.composer.bar` を `BOT_SESSION_PRIORITY` で、現在の Main を表示している間だけ登録（`createSlotRegistration`、登録先 `mainComposer`。断られたら Bots の欄に出す） |

- **下書き** はボットごと（その時点の Main ごと）にプラグインが読み込まれている間持つ。セッションを切り替えても戻ってくれば残っている。ローテーションで Main が替わっても同じボットの下書き。ページの再読み込みでは消える。
- **送信**: Enter（IME の確定は除く）か送信ボタン。添付がアップロード中・失敗のままなら送らずにお知らせを出す。送信中は本文を読み取り専用にし、ボタンは回転。届いたら下書きを空にする。断られたら下書きを残して理由をお知らせに出す（本文を変えると消える）。
- **ボタン**: 実行中で下書きが空なら停止（■）、それ以外は送信（↑）。実行中でも下書きがあれば送信（届け方は §3）。
- **添付**: ＋ボタン（ファイル選択、複数）、貼り付け（クリップボードのファイル）、カードへのドロップ。画像はサムネイル、ほかは名前のチップ。アップロード中は %、失敗は赤い縁と「失敗」（理由はツールチップ）、× で外す。
- **無効・ブロック**: Factory の `disabled` / `blocked`（理由をプレースホルダーに）に従う。接続中・Main が無い・つながらないときもプレースホルダーに理由を出して入力できない。

## 6. 見た目

ui-design.md「Composer」。DSH の composer のカード（`InputBar.module.css`）の寸法とトークンをそのまま使う: 幅は `--dsh-composer-card-max-width`、
`--dsw-specific-input-major`、radius panel、soft elevation、本文 14px / 24px、最大の高さ `--dsh-composer-text-max-height`、
左に 28px の＋、右に 34px の送信（info fill）。統計の行とメーターは無いので、カードの下は 12px の余白だけ。

## 7. 制約

- Web から送ったメッセージは DSH の `user` メッセージとして記録されるので、DSH の QueueDock では編集・削除・steer ができる（DSH の inbox の操作）。
- 送ったメッセージがタイムラインに出るのはターンの最初のメッセージとして足されたとき（queue で実行中に送ったものは今のターンの後）。それまでは DSH の QueueDock に出る。
- ステージした添付は Host のメモリにあり、DSH の再起動やページの再読み込み（下書きが消える）で使えなくなる。
