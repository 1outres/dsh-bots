# 初回起動ウィザードとアップデート後のお知らせ

決まったこと（2026-11-24、`feat/onboarding`）。dsh-bots を新しく入れた人には、できることの紹介・初期設定・最初のボットの作成を一続きで行うウィザードを出す。dsh-bots の版が上がった後には、その間の版のリリースノートを出す。

## 1. 考え方

- **どれかの画面で終わらせるまで出し続ける。** dsh web は複数のブラウザ画面で同時に開かれる。ウィザードとお知らせは、どれか 1 つの画面で最後まで進める／OK を押すまで、開いているすべての画面（後から開いた画面、再読み込みした画面も）に出る。どこかで終わったら、他の画面からもすぐに消える。
- だから「出すかどうか」は Host に保存する（`localStorage` は使わない）。ブラウザは Remote の `watch` で購読し、終わったことは冪等な操作で Host に記録する。
- **黙って消えない。** ウィザードにもお知らせにも × はなく、Escape・外側のクリックでも閉じない。終わるのは明示的な操作だけ（ウィザード: ボットを作って画面に移る、または「あとで作成」。お知らせ: OK）。
- 設定とボットの作成は既存のものを使う。Web lookup は `botWeb`、Google の OAuth クライアントは `botConnections`、チャネル（Discord）はボットの Channels と同じ検査と保存（`botChannels` の panel）、作成は `bots` と同じ `lifecycle.create`。画面の部品も dsh-bots settings、Channels、New bot ダイアログのものを共有する。

（2026-11-25 変更: 紹介は 1 枚に、初期設定に Discord を追加。§4.1、§7。）

## 2. 状態（Host）

- 保存先は `dsh_bot_onboarding`（version 1、表 `state`、キー `global` の 1 行）: `{ welcome, notesSeen, updatedAt }`。書くのは `host/onboarding/store.ts` だけ（design rule 57）。書き込みは直列。
- `welcome`:
  - `{ status: "open" }` — ウィザードを出す。
  - `{ status: "creating", botId, startedAt }` — ウィザードの中で最初のボットを作っている。
  - `{ status: "done", at, how, botId? }` — 終わった。`how` は `created`（ウィザードのボットができた）、`later`（「あとで作成」）、`existing`（§3、このウィザードより前からの環境）。`botId` はウィザードで作ったボット。
- `notesSeen`: リリースノートを確認した（または出すものが無く記録だけした）最新の dsh-bots の版。ノートの本文は保存しない（毎回 GitHub から読む）。

## 3. 最初の起動

行が無いとき（このウィザードが入って初めての起動）に一度だけ決める（`host/onboarding/initial.ts`、純粋な関数）。

- **既存の環境**: ボットが保存されている（作成中・削除中のものも）、または Web lookup の設定行がこの起動より前からある（bot-core が以前に動いた）、または OAuth クライアントが保存されている。`welcome` は `done`（`existing`）、`notesSeen` は `0.0.0`。だから今の版までのリリースノートが出る（§5）。
- **新しいインストール**: `welcome` は `open`、`notesSeen` は今の版（新しく入れた人にリリースノートは出さない）。
- 起動時には `notesSeen` を変えない。今の版のほうが新しければ、§5 のとおり GitHub からノートを読み、読めてから出すか記録する。

## 4. ウィザードのボット

- 作成は `botOnboarding.createBot(input, channels)`。入力は `bots.create` と同じ `BotCreateInput`、作成も同じ `lifecycle.create`。`welcome` が `open` のときだけ受け付け、作ったら `creating` にする（作成と記録は 1 本の列の中。2 つの画面で同時に作成を押しても 2 体目はできず、`bot-onboarding/closed` で断る）。
- Host がボットの一覧を追う（`host/onboarding/follow.ts`、判断は `host/onboarding/welcome.ts` の純粋な `welcomeAfter`）。起動時と一覧が変わるたびに:
  - `creating` のボットが一覧に載った（Main ができた）→ `done`（`created`、`botId`）。どの画面も開いていなくても終わる。
  - 作成中でも一覧にも無い（破棄された）→ `open` に戻す（作成のフォームに戻る）。
  - 作成に失敗したボットは `creating` のまま。ウィザードは失敗とやり直し・破棄を出す（`bots.retryCreate` / `bots.discardCreate`）。
- `botOnboarding.finishWelcome()`（「あとで作成」）: `open` なら `done`（`later`）。`creating` なら `done`（`created`、作成中の `botId`。作成はそのまま続く）。`done` なら何もしない（冪等）。

## 4.1 ウィザードのボットのチャネル

チャネルの設定（Discord の bot token、許可するユーザーなど）はボットごとなので、ボットがまだ無いウィザードでは次のようにする。

- ウィザードは、Host が今設定を保存できるチャネル（登録されていて、DSH の credential store があるもの）の一覧を `BotOnboardingView.channels` で受け取る（`host/onboarding/channels.ts`。チャネルの登録・credential store の出入りで更新）。無ければ手順ごと出さない。
- Discord の手順で入力したものは、その画面の中だけに下書きとして持つ（`client/onboarding/channel-drafts.ts`。再読み込み・ほかの画面には持ち越さない。localStorage にも書かない）。入力の検査は Host と同じ `parseChannelChange`。下書きは「スキップ」・作成の成功で捨てる。
- 作成のとき、オンで必須がそろった下書きだけを `createBot(input, channels)` の `channels`（`{ channelId, change }` の一覧）として送る。秘密の値がブラウザを出るのはこのときだけで、Host はそのまま credential store に入れる。
- Host は、何かを保存する前にすべての設定を各チャネルのフィールドで検査する（形が違う、提供していないチャネル、同じチャネルが 2 回 → `gateway/bad-request`、ボットは作らない）。ボットを作ったら（記録が保存されたら、Main を待たずに）、`botChannels.configure` と同じ panel で設定を保存する。保存に失敗したらボットを破棄（`discardCreate`）し、ウィザードは `open` のまま失敗を出す。
- 保存した設定は、ボットが一覧に載る（Main ができる）まで「待機中」、載ったら接続する（Channels と同じ）。作成が失敗したボットは設定を持ったまま、やり直しでも残る。破棄すれば、ほかのボットの削除と同じく設定も秘密も消える（`purge`）。
- チャネルのプラグインは、手順の短い案内を `BotChannelDescriptor.setup`（1〜8 行、en 必須）として出せる。ウィザードはそれを番号付きで見せる。Discord は Developer Portal でのアプリ作成、トークン（特権 Intent は不要）、招待、ユーザー ID のコピー。

## 5. リリースノート

（2026-11-25 変更: ノートはコードに持たず、GitHub Releases の本文から読む。）

- **今の版**は bot-core の `package.json` の `version`（パッケージは全部同じ版。テストが確かめる）、**どこから読むか**は同じ `package.json` の `repository`（GitHub の URL、`host/onboarding/source.ts` が owner と name に読む）。どちらもこの 1 か所だけが定義で、読めない形なら bot-core は起動しない（読み替えない）。
- **出どころ**: そのリポジトリの GitHub Releases（`https://api.github.com/repos/<owner>/<name>/releases`、100 件ずつのページを短いページまで。10 ページを超えたら失敗として扱う）。使うのはタグが `v<semver>` で draft でないもの（`image-*` などは除く）。本文（Markdown、英語）をそのまま出す。言語によらず英語で、ダイアログの見出し・ボタンだけが UI の言語になる。本文が空（空白だけ）のリリースは出すものが無い扱い。
- **いつ読むか**（`host/onboarding/notes.ts`）: `notesSeen` が今の版より古いあいだ、Host が起動時に 1 回読む。読めたノートはそのプロセスの間だけメモリに持つ（保存しない）。
  - 読めて、`notesSeen` より新しく今の版以下のノートが 1 件以上: 全画面に出す（`watch` が新しい view を流す）。
  - 読めて 0 件（その間のリリースが無い、本文が空のものしか無い）: 何も出さず、`notesSeen` を今の版にする（記録だけ）。
  - 読めない（オフライン、タイムアウト 20 秒、GitHub のエラー、レート制限、形の違う応答）: 何も出さず何も記録しない。1 分から倍々で最大 1 時間の間隔で読み直し、読めた時点で出す。代わりの表示はしない。
- 出すのは `notesSeen` より新しく、今の版以下の版のノート（新しい順）。
- `botOnboarding.acknowledgeReleaseNotes(version)`: 画面が出していた一番新しい版を渡す。`notesSeen` を `max(notesSeen, min(version, 今の版))` にする（冪等）。
- 版の比較は `MAJOR.MINOR.PATCH` と semver のプレリリース。形の違う版は例外にする（読み替えない）。
- **本文の書き方**: リリースする人が、タグを打つ前に英語で draft のリリースに書く（`infra/RELEASING.md`「Release notes」）。Release workflow はその draft をそのまま公開する。draft が無ければ workflow が作る既定の本文（インストールする版と変更履歴へのリンク）がそのまま出る。
- **描画**: bot-core の Markdown（`client/markdown.ts` のトークン、HTML としては描かない。`<script>` などは文字のまま）。裸の URL（GitHub が作る「Full Changelog: https://…」など）も GitHub と同じくリンクにする（`client/markdown.ts`、ファイルとノートの表示も同じ）。リンクは新しいタブで開く。版の見出しはそのリリースのページへのリンク。本文が長ければダイアログの中でスクロールし、下端をフェードさせてスクロールできることを示す。

## 6. Remote `botOnboarding`

- `watch()` → `BotOnboardingView`: `{ version, welcome, releaseNotes, channels }`。`releaseNotes` は `{ version, body, url }`（GitHub のリリースの本文とページ）。`welcome` は `open` / `creating`（`botId`）/ `done`（`botId?`）。
- `createBot(input, channels)` → `{ id }`。断るとき: `bot-onboarding/closed`、チャネルの設定が不正なら `gateway/bad-request`、作成そのものの断り（モデルなど）は `bots.create` と同じ。
- `finishWelcome()` → view。`acknowledgeReleaseNotes(version)` → view（版の形が違えば `gateway/bad-request`）。

## 7. 画面

- どちらも `shell.overlay` の全面のレイヤー（マスクの上の中央のパネル、≤ 640px では全面のシート）。どちらも出るときはウィザードが先。
- どちらもフォーカスを閉じ込める（bot-core のレイヤー、`ui/layers.ts`）。ただし新しいインストールでは DSH 自身の最初のダイアログ（ログイン・API キー）がウィザードの上に開くので、bot-core のレイヤーは、ほかの `aria-modal` のダイアログの中のフォーカス・Tab・Escape には手を出さない（設定画面の上に DSH のダイアログが開いたときも同じ）。ウィザードはページが変わるたびに、そのページの最初の操作にフォーカスを移す。
- **ウィザード**（`client/onboarding/`）。手順はページインジケーターで示し、戻る／次へで動く。
  1. ようこそ（1 枚）: 見出しは言語によらず「Welcome to dsh-bots!」。説明は「ボットごとの VM とコネクターで、仕事を引き継ぎ、私生活もサポートする。DSH が動いている間ずっと動き、用があればボットから話しかける」。主な機能を 4 枚のカード（アイコン、名前、一行）で: 複数のボット、ボットごとの VM とデスクトップ、コンテキストやコンパクションを意識しなくていい Main セッション、Gmail と Google カレンダー。イラストは `--dsw-*` のトークンで描く SVG。切り替えはスライドとフェード、`prefers-reduced-motion` では動かさない。
  2. Web lookup: dsh-bots settings の Web lookup と同じ部品（`WebLookupSection`）。bot-web が無い（バックエンドが登録されていない）と手順ごと出さない。
  3. アカウント: dsh-bots settings の OAuth クライアントのグループ（Redirect URI とコピー、Client ID、Client secret、セットアップガイド）。プロバイダーが無い（Google コネクターが無い）と手順ごと出さない。
  4. Discord（チャネル）: チャネルごとに手順（`setup`）と、ボットの Channels と同じグループ（`ChannelGroup`、オンのスイッチ、トークンの `SecretRow`、許可するユーザー、セットアップガイド）。保存先が下書きなだけで、部品と検査は同じ（§4.1）。オンで始まり、必須がそろうと「待機中」。
     2〜4 は「スキップ」で飛ばせる（4 のスキップは下書きを捨てる）。
  5. 最初のボット: New bot ダイアログと同じ入力（名前、アバター、モデル、タイムゾーン、作成オプションと VM）と同じ検査。実行環境（bot-vm）が無く容量が読めないときは、作成の代わりに「実行環境がありません」と理由、「もう一度確認」と「あとで作成」を出す。設定するチャネルがあれば「ボットと一緒に設定」に「作成後に接続」として並べる。
  6. 作成中: New bot と同じ段階の一覧と経過時間（最大 10 分ほど）。失敗したらやり直し・破棄。終わると `done` になり、その画面はボットの Main セッションを開く。
- `creating` の間は、どの画面も 6. を出す（後から開いた画面も）。
- 画面が `open` / `creating` のウィザードを出している間に `done` になったら（他の画面で終わった、Host が終わらせた）、ウィザードを閉じる。`botId` があれば、そのボットが一覧に載っていれば Main を開き、まだなら本体に作成の進み具合を出す（できたら Main を開く、New bot と同じ）。
- **お知らせ**: タイトル「dsh-bots が新しくなりました」、版ごとの見出し（リリースのページへのリンク）と本文の Markdown、OK だけ。

## 8. 置き場所

- `shared/onboarding.ts`（型、Remote）、`shared/release-notes.ts`（ノートの型、版の比較）。
- `host/onboarding/`: `source.ts`（版とリポジトリ）、`releases.ts`（GitHub API からノートを読む。`fetch` は注入、テストはフェイク）、`notes.ts`（読む時期、backoff、記録）、`channels.ts`（ウィザードが設定できるチャネル、検査と保存）、`domain.ts`、`initial.ts`（最初の記録と版の記録の純粋な関数）、`welcome.ts`（ウィザードの遷移と view の純粋な関数）、`store.ts`、`follow.ts`、`panel.ts`。
- `client/onboarding/`: `client.ts`（購読と操作）、`steps.ts`（何を出すかと手順の純粋な関数）、`OnboardingLayer.tsx`（ウィザードかお知らせか）、`Welcome.tsx`（枠と手順の移動、作成中）、`parts.tsx`（ページの共通部品）、`IntroPage.tsx`、`SetupPages.tsx`（Web lookup、アカウント、チャネル）、`BotPage.tsx`、`channel-drafts.ts`（チャネルの下書き）、`ReleaseNotes.tsx`、`art.tsx`。チャネルのグループは `settings/ChannelsSection.tsx` の `ChannelGroup`（保存先を `configure` で受け取る）。`client/styles-onboarding.ts`。`client/wiring/onboarding.ts`。
- 作成フォームは `client/creation/`（`use-creation-form.ts`、`BotCreationFields.tsx`）に切り出し、New bot ダイアログとウィザードが使う。言語の付与と断りの読み替えは `client/creation/request.ts`。
