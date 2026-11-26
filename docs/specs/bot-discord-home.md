# Discord のホーム（DM モードとチャンネルモード）

2026-11-26 に決めたこと。`packages/dsh-bot-discord` と bot-core のチャネル contract を作り直す。実装で確定したことは末尾の「9. 実装で確定したこと」に書く。

## 1. 考え方

- ボットの居場所（**ホーム**）は Discord の中に 1 つだけ。
  - **DM モード**: 1 人で使う。ホームはその人との DM で、その人がオーナー。
  - **チャンネルモード**: 複数人で使う。ホームはサーバーのテキストチャンネル 1 つ。
- ホームが一人で使うときの DM と同じ役をする。ボットが Discord に出すものはすべてホームに出す（返信、ファイル、ターンの通知、入力中、質問・承認・プラン確認のカード、コネクターの承認カードと承認待ちの一覧、ログイン情報の漏洩）。複数の DM への一斉送信はやめる。
- 設定画面で人やチャンネルの ID を打ったり貼ったりしない。候補は Discord から取って選ばせる。
- ペアリングコードは今回入れない。
- Main セッションは 1 つのまま（ホームが 1 つなので送り先に迷わない）。

## 2. 設定

| キー        | 種類                        | 中身                                                                                                                                               |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `token`     | secret                      | 今と同じ。                                                                                                                                         |
| `home`      | 選択（必須）                | `dm`、または `<guildId>:<channelId>`。候補は「ダイレクトメッセージ」と、ボットが入っているサーバーのテキストチャンネル（`#name (サーバー名)`）。   |
| `approvers` | 選択のリスト（1〜10、必須） | オーナー。キーは保存済みの設定との互換のため `approvers` のまま、ラベルは「Owners / オーナー」。DM モードではちょうど 1 人で、その人が DM の相手。 |
| `language`  | 選択                        | 今と同じ。                                                                                                                                         |

- `users`（会話できるユーザー）は無くす。チャンネルモードで話せる人は「ホームチャンネルを見られる人」で、Discord の招待・ロール・チャンネル権限で決まる。
- オーナーの候補:
  - DM モード: Developer Portal のアプリの所有者（チームのアプリならチームのメンバー）。
  - チャンネルモード: ホームチャンネルを見られるサーバーのメンバー（ボットは除く）。アプリの所有者を先頭に置く。
- 初期値: トークンを入れたら、`home` は `dm`、オーナーはアプリの所有者（チームならオーナー）を下書きとして提案する。保存は人が選んでから（勝手に保存しない）。
- 項目をまたぐ検査（DM モードならオーナーは 1 人、チャンネルモードならオーナーがホームチャンネルを見られる）は Discord が持ち、設定の保存前に bot-core が呼ぶ（§4）。

## 3. Discord の動き

### 3.1 接続

- DM モード: Intent は今と同じ `DirectMessages` だけ（特権 Intent なし）。
- チャンネルモード: `Guilds`、`GuildMessages`、`MessageContent`（特権）、`GuildMembers`（特権、オーナーの候補と表示名のため）。DM は使わない。
- 特権 Intent が Portal でオフのとき（close 4014）は、どの Intent をどこで入れるかを「失敗」の理由に出す。設定画面でも、接続の前にアプリの flags から分かる範囲で注意を出す（§4 の `inspect`）。

### 3.2 受け取る発言

- DM モード: オーナーとの DM の発言だけ。ほかの人からの DM は捨てる（返事もしない）。
- チャンネルモード: ホームチャンネル直下の発言だけ。スレッド、ほかのチャンネル、DM（コマンドとボタンを除く）は捨てる。そのチャンネルの人（ボットと自分自身は除く）の発言はすべて Main に届ける。オーナーかどうかは bot-core が見出しに付ける。
- 受け取る種類（DEFAULT と REPLY だけ）、届いたときのリアクション（👀 / ⚠️ と理由の返信）、届ける順番と 1 回だけ届けること、新しい Gateway セッションのときに取りこぼした発言を読み直すこと、添付の扱いは今と同じ（ホームの 1 チャンネルで行う）。
- 見出しの場所: DM は `DM`、チャンネルは `#<チャンネル名> (<サーバー名>)`。

### 3.3 出すもの

| 出力                                   | DM モード | チャンネルモード                             |
| -------------------------------------- | --------- | -------------------------------------------- |
| 返信、ファイル、ターンの通知、入力中   | DM        | ホームチャンネル                             |
| 質問・承認・プラン確認のカード         | DM        | ホームチャンネル（1 枚）                     |
| コネクターの承認カードと承認待ちの一覧 | DM        | ホームチャンネル（1 枚ずつ。一覧はピン留め） |
| ログイン情報の漏洩                     | DM        | ホームチャンネル                             |

- カードを押せる人:
  - 質問: DM モードではオーナー。チャンネルモードではホームチャンネルにいる誰でも。
  - 承認、プラン確認、コネクターの操作: オーナーだけ。ほかの人には本人だけに見える断りを返す。
- チャンネルモードの質問カードは 1 枚を皆で共有するので、下書き（選んだ答え、ページ）もカードに 1 つ。誰が押しても同じ下書きが進む。
- チャンネルモードではコネクターの操作の中身（メールの本文など）と漏洩の報告がホームチャンネルの全員に見える。オーナーがそれを承知でホームを選ぶものとし、設定画面のホームの説明にもそう書く。
- メンションで人を呼ばない（`allowed_mentions: { parse: [] }`）のは今と同じ。

### 3.4 スラッシュコマンド

- `/stop`、`/status`、`/new`、`/pending`。DM モードでは DM で、チャンネルモードではホームチャンネルで使える。
- ホームでない場所での実行には、本人だけに見える断りを返す。
- 誰が実行できるかは bot-core の `BotCommandSpec.access` のまま（`owners` なら照らすのはオーナー）。`/pending` はオーナーだけで、答えは本人だけに見える。

## 4. bot-core のチャネル contract に足すもの

- **選択の項目**: `BotChannelField` に `kind: "pick"`（値 1 つ）を足し、`list` の `item` に `source` を持てるようにする。どちらも候補は `source`（チャネルが付ける名前）からチャネルが返す。値は ID の文字列のまま保存する。
- **候補を返す**: `BotChannel.options(request)`。`request` は `source`、ボット、保存済みの値と秘密（ウィザードでは下書きの値と秘密）、`signal`。返すのは `{ value, label, detail?, image? }` の一覧か、出せない理由（`BotChannelText`。例: トークンが無い、GuildMembers Intent がオフ）。接続していなくても呼べること（Discord は REST だけで答える）。
- **項目をまたぐ検査**: `BotChannel.check(values)`。合わなければ理由（`BotChannelText`）を返す。bot-core は保存の前に `parseChannelChange` の後で呼び、合わなければ保存しない。
- **設定画面の補足**: `BotChannel.inspect(request)`。トークンから分かること: アカウント名、招待 URL（`scope=bot applications.commands` と要る権限）、注意（例: チャンネルモードなのに Message Content Intent がオフ）。
- **場所**: `BotMessagePlace` に `{ kind: "channel"; channel: string; server: string }` を足し、`placeOf` が `#<channel> (<server>)` にする（名前は `headerName` と同じ扱い）。
- **名前**: 接続は `report({ state: "connected", account, people })` で、オーナーの ID → 表示名を知らせる。`bot:status` は ID ではなくこの名前で出す（`owners: Alice (@alice)`）。
- **設定の移行**: チャネルが設定の形を変えられるように、`BotChannel.settingsVersion` と `upgradeSettings(values, from)` を持たせる。bot-core は古い版の記録を読んだときに変換し、保存し直す。
- Remote `botChannels` に `options` と `inspect` を足す。ブラウザから秘密を送るのはウィザードの下書きのときだけ（保存済みの秘密は Host が使い、ブラウザには出さない）。
- 設定画面とウィザードは、`pick` と `source` 付きの `list` を候補の選択欄（アバター、表示名、補足）として描く。候補はトークンと関係する値が変わったら取り直す。

## 5. 今の設定からの移行（Discord の settingsVersion 1 → 2）

- `home` は `dm`。
- `approvers` は 1 人にする: 会話できるユーザーにも入っているオーナーの最初の人。いなければオーナーの最初の人。それもいなければ会話できるユーザーの最初の人。
- `users` は捨てる。
- 移行で外れた人がいたら、warn で記録する。

## 6. プロンプト

- `## Messages and channels` の見出しの例に、チャンネルの例 `[Discord · #general (Team) · Bob (@bob)]` を足す。
- 共有のチャンネルでは、ボット宛てでない発言にも届くことを書く。そのときは `stay_silent` を使う。
- Discord の `formatHint` は今と同じ。

## 7. 変えないもの

- ボットごとに Discord のボット（トークン）が 1 つ。
- 添付と書式、2000 文字での分割。
- 保存の domain `dsh_bot_discord`。コネクターの承認カード（`cards`）、一覧（`digests`）、漏洩（`incidents`）の記録は、オーナーごとではなくホームごと（ホームのチャンネル 1 つに 1 枚）になるので、記録の形を変えて版を上げる。前の版の記録は、ホームの DM のものだけを引き継ぎ、それ以外は忘れる（カードはホームに出し直す）。

## 8. 対象外

- スレッド、ホームが 2 つ以上、グループ DM、ペアリングコード、Discord の中から設定を変えること（`/home`、`/owner` など）。
- ボットが自分の設定を読み書きする `bot_settings` は別の仕様にする（この仕様の後）。

## 9. 実装で確定したこと

**bot-core のチャネル contract**（`shared/channels.ts`、`channel-contract.ts`）

- `BotChannelPickField`（`kind: "pick"`、`required`、`source`、`maxLength`、`pattern?`、`clears?`）と、`list` の `item.source?` を足した。値は文字列のまま保存し、Host での検査は text と同じ（長さと `pattern`）。候補にあるかどうかは見ない（候補は Discord の今の状態で変わるので、保存済みの値を候補で弾くと消えた人やチャンネルの設定を読めなくなる）。
- **`clears` を足した**: `pick` が変わったとき、同じ保存で空にする項目のキー。仕様のままだと、項目ごとに保存する設定画面で「ホームを変える → 今のオーナーがそこを見られないので `check` が保存を断る → オーナーの候補は保存済みのホームのまま」と抜け出せなくなるため。Discord の `home` は `clears: ["approvers"]`。ホームを変えるとオーナーは空になり、設定は未入力（接続しない）になって、新しいホームの候補から選び直す。
- `BotChannel.options(request)` の答えは `{ state: "ready", options, suggested } | { state: "unavailable", reason }`。`suggested` は §2 の「下書きとして提案」のための値の一覧で、設定画面は項目が空のあいだ「提案: …」と **これにする** ボタンを出す（押すまで保存しない）。`label`・`detail` は `BotChannelText`（「ダイレクトメッセージ」を訳すため。人やチャンネルの名前は `{ en }` だけ）、`image` は https の画像。
- **`check` と `inspect` は値だけでなく request（`bot?`、値と秘密、`signal`）を取る非同期の関数にした**。チャンネルモードの「オーナーがホームチャンネルを見られる」はトークンで Discord に聞かないと分からないため。`check` の答えは `{ ok: true } | { ok: false, reason }`。bot-core は、変更を当てた後の設定が **有効で、必須の項目がそろっている** ときだけ保存の前に聞く（無効のあいだや入力の途中は聞かない。オンにするとき聞く）。断られたら保存せず、`botChannels.configure` は `{ saved: false, reason }` を返し、設定画面はその項目に理由を出す。
- `inspect` の答えは `{ state: "ready", account?, links, warnings } | { state: "unavailable", reason }`。設定画面はチャネルの見出しの下に、アカウント、注意（要確認の印）、リンクの順に行を出す。
- `settingsVersion?`（無ければ 1）と `upgradeSettings({ version, values })` → `{ values, notes }`。`settingsVersion` が 2 以上なら `upgradeSettings` を、`source` を持つ項目があれば `options` を必須にし、登録時に検査する（`checkChannelHooks`）。
- `BotMessagePlace` に `{ kind: "channel", channel, server }`。見出しの場所は `#<channel> (<server>)`（名前は `headerName` で整える）。
- `BotChannelConnectionState` の `connected` に `people?: Record<id, { displayName, handle }>`。
- **`BotChannelLink.openActions()` を足した**: ボットの承認待ちの操作（古い順）。チャンネルモードでは承認待ちの一覧をホームチャンネルの全員に出すので、`pendingActions(person)`（オーナーか確かめる読み取り）では作れないため。`connectorActions` を宣言したチャネルにだけ返す（`connector-action` の出力と同じ中身）。`/pending` は今までどおり `pendingActions(person)`。
- 質問・承認・プラン確認の答え（`link.answer`）は人を取らないまま。承認とプラン確認を「オーナーだけ」にするのはチャネル（Discord）が設定のオーナーと照らして行う。

**bot-core**

- 記録 `dsh_bot_channels` の `channels` に任意の `settingsVersion` を足した（互換の変更なので版は 1 のまま、スナップショットを更新）。保存のたびにチャネルの今の版を書く。
- 古い版の記録は、読むとき（`view`）に `upgradeSettings` を通した値で見せ、チャネルが登録されたときにまとめて保存し直す（`ChannelSettings.upgrade`）。`notes` は `bot-core: settings of channel "discord" of bot <id> upgraded to version 2: …` の warn にする。接続（`hub.sync`）は保存し直した後に始める（先に繋ぐと、保存で revision が変わってもう一度繋ぎ直すため）。
- チャネルより **新しい版の記録は読まない**（オフで空の設定に見え、接続しない。保存するまで記録は書き換えない）。古いプラグインに戻したときに、意味の分からない値で繋がないため。
- Remote `botChannels` に `options(channelId, settings, source)`、`inspect(channelId, settings)`、`check(channelId, settings)` を足した。`settings` は `{ kind: "bot", botId }`（保存済みの秘密は Host が資格情報ストアから読む）か `{ kind: "draft", values, secrets }`（ウィザードの下書き。値は変更と同じく検査する）。チャネルに答える時間は 15 秒まで。
- ウィザードの下書きも、有効で必須の項目がそろったら Remote の `check` で検査してから保持する（ボットを作るときの保存で初めて断られないように）。ボットを作るときの保存で断られたら、そのボットは作り直しにする（今までの「保存できない設定は捨てる」と同じ）。
- 設定画面とウィザード: `pick` と `source` 付きの `list` は `OptionPicker`（画像、名前、補足、検索欄。リストは選んだ人を並べ、押すたびに足し外しする）。候補と `inspect` は、保存のたびに増える `BotChannelView.revision` と値が変わったら取り直す（トークンの差し替えも revision で分かる）。候補が出せないときは理由をその行に出す。候補に無い保存済みの値は「候補にありません」と ID で出す。
- `bot:status` のオーナーは、接続が知らせた名前を `Alice (@alice)` で並べる（名前は `headerName`・`headerHandle` で整える）。名前の無い人は ID を出さずに数える: 接続していないときは `owners: 2 listed, names known once connected`、一部だけ分かるときは `…, 1 more whose names are unknown`。docs/specs/bot-system-prompt.md §3.1 の「ID をそのまま並べる」はこれで置き換わる。
- §6 のプロンプト: 見出しの例にチャンネルの例を足し、「共有のチャンネルでは自分宛てでない発言にも届く。そのときは stay_silent」の 1 行を足した。

**Discord**

- 設定の版は 2。項目は `token`、`home`（pick、`dm` か `<guildId>:<channelId>`）、`approvers`（1〜10、候補 `owners`）、`language`。`home` の説明に、チャンネルモードではコネクターの操作の中身と漏洩の報告がチャンネルの全員に見えることを書いた。
- 候補・検査・補足は REST だけで答える（`DiscordLookup`、アダプターは discord.js の `REST`）。
  - ホームの候補: 「ダイレクトメッセージ」と、ボットがいるサーバーのテキストチャンネル（`GuildText` のみ）のうち、ボットが **見る・投稿する・履歴を読む** ことができるもの（ロールとチャンネルの上書きから計算: `permissions.ts`）。ラベルは `#name (サーバー名)`、画像はサーバーのアイコン。提案は `dm`。
  - オーナーの候補: DM モードはアプリの所有者（チームならメンバー、チームのオーナーが先頭）、チャンネルモードはホームチャンネルを見られるメンバー（ボットは除く。アプリの所有者が先頭）。チャンネルモードの一覧は Server Members Intent が要り、アプリの flags でオフなら理由を返す。メンバーは 1 サーバー 5000 人まで読む。保存済みのオーナーが候補にいないとき（v1 から移行した、アプリの所有者でない人など）は、その人を `GET /users/:id` で読んで候補の末尾に足す（名前で見えるように）。
  - 検査: DM モードはオーナーがちょうど 1 人か。DM モードのオーナーがアプリの所有者かどうかは見ない（v1 から移行した設定をそのまま使えるように）。チャンネルモードは、ボットがホームチャンネルを見て投稿して履歴を読めること、オーナーそれぞれがサーバーのメンバーでチャンネルを見られること（1 人ずつ `GET /guilds/:id/members/:user`。これは特権 Intent が要らない）。
  - 補足: アカウント名、招待 URL（`scope=bot applications.commands`、権限は View Channel、Send Messages、Read Message History、Embed Links、Attach Files、Add Reactions、Pin Messages）、Developer Portal のボットのページ、チャンネルモードで Message Content / Server Members Intent がオフならそれぞれの注意。
- 接続: DM モードは `DirectMessages`（partial `Channel`）、チャンネルモードは `Guilds`、`GuildMessages`、`MessageContent`、`GuildMembers`。close 4014 の理由は「サーバーのチャンネルのホームには Message Content Intent と Server Members Intent が要る。Developer Portal > Bot > Privileged Gateway Intents でオンにする」。
- コマンドは DM モードでは `contexts: [BotDM]`、チャンネルモードでは `[Guild]` で登録する（グローバルなので、ほかのサーバーやチャンネルでも出るが、ホームでなければ本人だけに見える断りを返す）。
- 名前: 接続のはじめに REST でオーナーの名前を読み（チャンネルモードはサーバーのニックネーム）、`connected` の報告に `people` を付ける。名前が後から分かったら、接続中ならもう一度報告する（`people.ts`）。発言の送り主の表示名も、サーバーではニックネームを使う。
- カードを押せる人と場所: どのボタン・フォーム・コマンドも、ホーム（DM モードはオーナーとの DM、チャンネルモードはホームチャンネル）で押されたものだけを受ける。質問はホームの誰でも、承認とプラン確認はオーナーだけ、コネクターの操作は bot-core が `decide` でオーナーか確かめる。
- 記録 `dsh_bot_discord` を版 3 にした（版 1・2 を読む）。`cards` は `<bot>:<action>`、`digests` は `<bot>`、`incidents` は `<bot>:<incident>` で、どれも置き場所のチャンネル（`channelId`）を持ち、`userId` は持たない。版 2 の記録はそのまま読めるので（`userId` は落ちる）、接続のはじめ（ホームのチャンネルが分かった時点で、何かを出す前）に、そのボットの記録のうちホームのチャンネルにあるものを新しいキーに移し、それ以外は忘れる（`adoptApprovalRecords`、`adoptIncidentNotices`）。ホームを変えたときも同じで、前のホームのカードは追わなくなり、承認待ちのカードと一覧は新しいホームに出し直す。忘れたカードは編集しない（以前の「承認者から外れた人のカードを取り下げる」はやめた。そのカードを押してもホームでないので断る）。
- チャンネルモードの承認待ちの一覧のリンクは `https://discord.com/channels/<guildId>/<channelId>/<messageId>`。
- ファイルは送り先が 1 つになったので、送れなければその出力を失敗にする（bot-core が Main セッションに伝える）。返信やターンの通知も、送れなければ出力の失敗として bot-core が warn にする。
- DM モードでオーナーを別の人に替えるときは、今のオーナーを外してから選ぶ（2 人にする保存は `check` が断る）。外した時点で必須の項目が空になり、選ぶまで接続しない。オーナーの選択欄は `list` のままで、モードによって 1 つ選びにはしない（項目の種類を値で変えないため）。
- 確かめていないこと: 本物の Discord のトークンが無いので、接続、REST の答え、権限の計算、特権 Intent と close 4014 の振る舞いは、discord.js をスタブにしたテストと仕様（Discord の公式ドキュメント）でしか確かめていない。
