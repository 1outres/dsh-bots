# ボットの Main ビュー 仕様

状態: `feat/main-view` で実装。

## 目的

ボットの Main セッションを開いたときの会話カラムに、DSH 標準の Chat ビュー（ツール呼び出し、thinking、notice、ツール結果がすべて見える）ではなく、
**ボットのチャネル（Discord など）で見える程度の情報量** だけを出す。見た目は Discord を真似ず、DSH / dsh-bots のデザインに馴染むチャット UI にする。
DSH 標準の Chat ビューは、シェルのメニューバーの「セッションログ」パネルからいつでも見られる。

## 1. 範囲

- 対象は **現在の Main**（`BotView.mainSessionId` のセッション）だけ。Web UI で開いた別セッションや、復元して開いた過去の Main は従来どおり DSH の Chat を出す。
- Interaction composer（質問・承認・プランレビュー）、幅の調整、hero などは DSH の `conversation.content` Factory のまま。
  bot-core は Factory の `views` 位置を差し替える（`MainConversationView`）。composer の本体（`conversation.composer.bar`）は bot-core の入力欄で、
  書いたものはチャネルと同じ入力ゲートを通って Main に届く（docs/specs/bot-main-composer.md）。
- コネクターのアクションは Actions パネル（ui-design.md）、ファイルは Files パネルのまま。

## 2. タイムラインに出すもの（`host/main-view/timeline.ts`）

セッションログ（`surfaceOp: "append"` で足されたメッセージ）をイベントごとに畳み込む純粋関数 `foldEvent` / `timelineOf`。
保存されたログもライブのイベントも同じ関数で読む。メンテナンスのターンと `stay_silent` の判定はログだけから行い、Host のメモリ上の状態（`turnSilence`、`maintenanceTurns`）には頼らない。

| 項目                           | 元になるもの                             | 規則                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 人のメッセージ `person`        | `user/message`、`source.kind === "user"` | 常に出す（メンテナンスのターン中でも）。本文の先頭行がチャネルのヘッダ（`[Discord · DM · Alice (@alice, owner)]`、`host/channels/header.ts`）なら送り主に変換して本文から外す（`host/main-view/origin.ts`）。ヘッダが無ければ Web UI のオーナー。末尾の「Attached files, saved in your workspace:」の段落（`host/channels/inbound.ts`）は、チャネルのものも Web UI の入力欄のものも添付ファイルに変換する。画像（`image` ブロック）とファイル（`file` ブロック）も添付として持つ |
| ボットの返信 `reply`           | `assistant/message`                      | text ブロックだけ（`replyOf`、`host/channels/feed.ts` と同じ）。中断された返信はその印                                                                                                                                                                                                                                                                                                                                                                                           |
| 提示されたファイル `presented` | `deliverables/presented`                 | パスと説明                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ターンの結果 `turn`            | `turn/end`                               | 失敗（理由）と停止だけ（`endedTurnOf`）。完了は出さない                                                                                                                                                                                                                                                                                                                                                                                                                          |

出さないもの: reasoning、ツール呼び出しと結果、notice（コネクター・スケジュール・イベントなど bot-core の `source`）とシステムの指示（最初のあいさつの指示など）、コンテキストのメッセージ。

- **メンテナンスのターン**: ターンの最初に足された user メッセージの `source.kind` が `bot-main`（`host/mains/turns.ts` の記憶の書き出し）なら、そのターンの返信・ファイル・結果は出さない。
- **`stay_silent`**: ターン中の `stay_silent` の呼び出しの結果が成功（`isError` でない）になった後の返信とファイルは出さない（チャネルで withheld されるもの）。呼び出しと同じメッセージの text はチャネルにも出ているので出す。
- **notice のターン**: notice 自体は出さず、その返信は出す（チャネルと同じ）。
- **入力中**（`replying`）: チャネルが見るターン（最初のメッセージでメンテナンスでないと分かったもの）が走っている間。
- 過去の Main は、新しい Main に替わった時刻（`retiredMain.endedAt`）より後のイベントを読まない（復元して書いたものは Main の会話ではない）。

## 3. コントラクト（`shared/main-view.ts`、Remote `botMainView`）

```ts
interface BotMainViewApi {
  watch(botId, signal?): AsyncIterable<MainTimelineFrame>
  page(botId, before: MainTimelineCursor, signal?): Promise<MainTimelinePage>
  image(botId, sessionId, attachmentId, signal?): Promise<MainTimelineImageData>
}
type MainTimelineFrame =
  | { kind: "start"; mainSessionId; items; earlier?: MainTimelineCursor; replying }
  | { kind: "next"; mainSessionId; items; replying }
```

- 項目（`MainTimelineItem`）は `{ id, sessionId, seq, at }` と種類ごとの中身。`sessionId` と `seq` が、ボットの Main の並び（古い順、`BotRegistry.mainsOf`）の中での位置。
- `watch` の最初のフレーム `start` は新しい方から最大 `MAIN_TIMELINE_PAGE`（40）件。今の Main に足りなければ過去の Main からも埋める。
  以後の `next` はそのストリームで送った後に足された項目だけ。ローテーションで Main が替わると、同じストリームが新しい Main の項目を続けて送る（区切りは無い）。
- `page` はカーソルより前の項目を最大 40 件、Main をまたいで返す。`earlier` が無ければ一番古いところまで読んだ。カーソルがボットの Main でなければ断る。
- `image` はボットの Main の人のメッセージにある画像だけを、DSH の `attachments.readImage` で読んで base64 で返す。
- ライブの Main は `watch` されている間だけ Host のメモリに項目を持つ（`host/main-view/panel.ts`）。読み始めにセッションログ（`sessionQuery`、設計ルール 55 のとおり `index.ts` で配線）を読み、
  その間に届いた `session/event` は溜めておき、ログの続き（`seq` がより大きいもの）だけを足す。過去の Main の項目は数件までキャッシュする（ログは変わらない）。

## 4. Client

- `client/main-view/state.ts`: ストアの純粋な遷移（`applyFrame`、`pageLoaded` など）。`start` は持っている項目を置き換える（再接続で取りこぼした分があり得るため）。
- `client/main-view/model.ts`: ボットごとのモデル（`followStream` で再接続、古い方のページ読み）。`createFeedHub` で購読がある間だけ。
- `client/main-view/rows.ts`: 表示の純粋関数。日付が変わるところに日付の行、同じ人（またはボット）の 5 分以内の連続を 1 グループにする。
- `client/main-view/MainTimeline.tsx`: 描画。スクロールは `conversation.content` のスクロール本体（`[data-conversation-scroll]`）。末尾にいる間は新しい項目に追従し、上端近くで古いページを読み、読み足した分だけスクロール位置を保つ。
- **セッションログ**: メニューバーの項目「セッションログ」（Main のときだけ。`ShellMenuEntry.shown`）でパネル（`SidePanel` の `session-log`）を開く。
  パネルは本体の要素を `SessionLogSeats` に出し、`views` 位置の `MainConversationView` が DSH の `conversation.session`（Chat）を React portal でそこに描く。
  Factory の中で描くので DSH の Chat はそのままの文脈で動き、スクロールの持ち主（`[data-conversation-scroll]`）が無いのでパネルの中で自分でスクロールする。
- ローテーションで Main が替わったとき、表示していたのが前の Main なら新しい Main を開く（`wiring/main-view.ts`）。

## 5. 見た目

ui-design.md の「Bot session (chat)」。人のメッセージは右寄せの吹き出し（DSH のユーザーメッセージと同じ `--dsw-specific-bubble`、radius-xl、10px 16px）、
その上に 12px の一行（名前、オーナー・ボットの Tag、経路「Discord · DM」/「Web UI」、時刻）。ボットの返信は左にアバター 28px、名前と時刻、Markdown 本文。
画像は 1 枚なら長辺 240px、複数は 96px 四方。ファイルは DSH のファイルカードに近いチップ（ワークスペースのファイルは Files パネルで開く）。
ターンの失敗・停止はアバターの列に揃えた小さな一行。入力中はアバターと 3 つの点。一番古いところまで読むと、先頭にボットのアバター 48px と名前。

## 6. 制約

- 「入力中」は、ターンの最初のメッセージが足されてから出る（メンテナンスかどうかが分かってから）。DSH の `turn/start` から数百ミリ秒遅れる。
- チャネルでだけ起きること（チャネルへの配信の失敗、質問のカードなど）はログに無いので出さない。
- 画像はページの間ブラウザに URL として残る（attachment は内容で決まる id なので一度だけ読む）。
