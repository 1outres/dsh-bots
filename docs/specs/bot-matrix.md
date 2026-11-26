# Matrix チャネル

2026-11-26 に決めたこと（仕様と spike）。新しいパッケージ `packages/dsh-bot-matrix`（row id `bot-matrix`、チャネル id `matrix`）と、bot-core のチャネル contract に足す汎用の仕組み（チャネル全体の設定、新しいボットで既定でオン、ボットごとのアカウント）を作る。`feat/channel-profile`（ボットの名前とアバターをチャネルに反映する `profile` 出力と `profileSync`、main の 8c1f078）の上に作った。spike の記録は「11. spike で確かめたこと」、実装で決めたことは「13. 実装で確定したこと」。

## 1. 考え方

- **セルフホストの homeserver が前提**。ボットごとの Matrix アカウントはプラグインが用意する。人が Matrix 側でアカウントを作ったりトークンを貼ったりしない。
- **設定は 2 段**。homeserver との接続（URL、実装、Application Service のトークン、ユーザー名の接頭辞、既定のオーナー、新しいボットでオンにするか）は **dsh-bots の全体設定** で一度だけ。ボットごとの設定（ホーム、オーナー、言語）は Discord と同じ形で、新しいボットでは自動で埋まる。
- **アカウントの用意は Application Service（AS）**。登録ファイルは `url: null`（homeserver から Host への着信は要らない）。ボットのユーザーは AS の名前空間 `@<prefix>_<botId>:<server>`。要求はすべて AS のトークン（`as_token`）と identity assertion（`?user_id=<ボットの MXID>`）で送る。各ボットはその MXID として普通のクライアントと同じく `/sync` する。ボットごとのアクセストークン（`/login` の `m.login.application_service`）は使わない（§4.1 と spike 2）。
- **homeserver ごとの差は差し替え**（§4）。今は Synapse と Tuwunel。実装は全体設定で人が選ぶ。自動で判別して切り替えることはしない（`check` が選んだ実装と実物が合うかを確かめる）。
- **E2EE はしない**。暗号化された部屋はホームにできず、ボットが作る DM も暗号化しない。
- **ホームは Discord と同じ**（docs/specs/bot-discord-home.md）: 「オーナーとの DM」か「部屋 1 つ（複数人）」。ボットが Matrix に出すものはすべてホームに出す。オーナー、言語、カードを押せる人、見出し、`stay_silent` の扱いも同じ。
- **Matrix にはボタンが無い**。カードは本文と、ボットが先に付けておくリアクション、カードへの返信（`m.in_reply_to`）で答えさせる（§6.5）。スラッシュコマンドの代わりは `!stop` などのテキストのコマンド（§6.4）。
- fallback は作らない。使えない機能は「使えない」と理由を出す（例: Tuwunel ではアカウントを無効化できないので、部屋を出てプロフィールを消すだけと明示する）。

## 2. 全体設定（Matrix サーバー）

dsh-bots の設定（全体設定画面）に、チャネルごとのセクション「Matrix」を bot-core が出す（§3.4）。項目は Matrix プラグインがチャネル全体のフィールドとして宣言し、保存・秘密・検査・描画は bot-core がボットごとの設定と同じ部品で行う。

| キー           | 種類                               | 中身                                                                                                                                                |
| -------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server`       | text（`choices`、必須）            | homeserver の実装: `synapse` / `tuwunel`（§4 の登録済みの実装から作る）。                                                                           |
| `homeserver`   | text（必須、`https?://…`、512 字） | Client-Server API の URL（例 `https://matrix.example.org`）。`.well-known` は読まない（書かれた URL だけに送る）。                                  |
| `asToken`      | secret（必須、256 字）             | 登録ファイルの `as_token`。人が `openssl rand -hex 32` などで作り、登録ファイルとここの両方に入れる。                                               |
| `prefix`       | text（必須、`[a-z0-9._=-]{1,32}`） | ボットのユーザー名の接頭辞。ボットの MXID は `@<prefix>_<botId>:<server_name>`、AS の送り主は `@<prefix>:<server_name>`。placeholder は `dshbots`。 |
| `defaultOwner` | text（任意、MXID の形、255 字）    | 既定のオーナー。新しいボットはこの人との DM をホームにして自動でオンになる（§3.2）。空なら新しいボットで自動でオンにしない。                        |

- **新しいボットでオンにする**（スイッチ）は Matrix のフィールドではなく、bot-core が持つチャネル全体の設定 `newBots`（§3.2）。Matrix ではオンにしても `defaultOwner` が空なら効かず、画面にそう出す（`describeInitial` が理由を返す）。
- `server_name` と AS の送り主は入力させない。`as_token` で `GET /account/whoami` を呼ぶと `@<sender_localpart>:<server_name>` が返る（spike 3）ので、そこから読む。読んだ送り主の localpart が `prefix` と違えば `check` が断る（登録ファイルと設定のずれ）。
- **保存先**: 値（`server`、`homeserver`、`prefix`、`defaultOwner`）と `newBots` は bot-core の `dsh_bot_channels` のテーブル `shared`（§3.6）。`asToken` は bot-core の資格情報ストアの record `bot-core/shared-channel-matrix`（`{ version: 1, secrets }`、ボットごとの `bot-core/channel-<id>-<botId>` と同じ形）。プラグインの cordis Config には何も置かない（Config は `.hidden()` の検証用の値も含めて持たない）。ブラウザには設定済みかだけを返す。
- **登録ファイルの雛形**: 全体設定の補足（`inspect`、§3.1）が、入力中の `prefix` と読めた `server_name` から雛形を出し、コピーできるようにする。トークンは `<as_token>`・`<hs_token>` のまま（保存済みの秘密をブラウザに出さない）。

```yaml
id: dsh-bots
url: null
as_token: <as_token>
hs_token: <hs_token>
sender_localpart: dshbots
rate_limited: false
namespaces:
  users:
    - exclusive: true
      regex: "@dshbots_.*:matrix\.example\.org"
  aliases: []
  rooms: []
```

- `rate_limited: false` は必須（Synapse は identity assertion の要求をこれで制限から外す。spike 2）。`exclusive: true` で、ほかの人がこの名前空間のユーザーを作れないようにする（spike 1）。
- どこに置くかは実装ごとの案内（§4 の `registrationGuide`）: Synapse は `app_service_config_files` に足して再起動、Tuwunel は `appservice_dir` に置いて再起動（または `!admin appservices register`）。
- **変えられないとき**: `prefix` と、`as_token` で読める `server_name` は、使用中のアカウント（`accounts` の `active`、§7）があるあいだ変えられない（`check` が断る。理由は「Matrix のアカウントを持つボットがあるので変えられません。それらのボットを削除するか、同じ homeserver と接頭辞のままにしてください」）。名前空間の外になったアカウントを黙って捨てないため。`homeserver` の URL（同じサーバーへの別の URL）と `as_token` の差し替えは変えられる。

## 3. bot-core のチャネル contract に足すもの

Matrix 専用にせず、どのチャネルでも使える形にする。Discord は今は使わない（使わないものは宣言しない）。`feat/channel-profile` の `BotChannelChange.profileSync`、`capabilities.profile`、`profile` 出力、`reportProfile` はそのまま前提にする。

### 3.1 チャネル全体の設定

```ts
interface BotChannel<
  F extends readonly BotChannelField[] = readonly BotChannelField[],
  S extends readonly BotChannelField[] = readonly [],
> extends BotChannelDescriptor {
  readonly shared?: BotChannelShared<S>
  options?(
    request: BotChannelOptionsRequest<BotChannelValuesOf<F>, BotChannelValuesOf<S>>,
  ): Promise<BotChannelOptions>
  check?(
    request: BotChannelSettingsRequest<BotChannelValuesOf<F>, BotChannelValuesOf<S>>,
  ): Promise<BotChannelCheck>
  inspect?(
    request: BotChannelSettingsRequest<BotChannelValuesOf<F>, BotChannelValuesOf<S>>,
  ): Promise<BotChannelInspection>
  initialSettings?(
    request: BotChannelInitialRequest<BotChannelValuesOf<S>>,
  ): Promise<BotChannelInitial>
  readonly accounts?: BotChannelAccounts<BotChannelValuesOf<S>>
  connect(link: BotChannelLink<BotChannelValuesOf<F>, BotChannelValuesOf<S>>): BotChannelConnection
}

interface BotChannelShared<S extends readonly BotChannelField[]> {
  readonly fields: S
  readonly description?: BotChannelText
  readonly settingsVersion?: number
  upgradeSettings?(stored: BotChannelStoredSettings): BotChannelSettingsUpgrade
  options?(
    request: BotChannelSharedOptionsRequest<BotChannelValuesOf<S>>,
  ): Promise<BotChannelOptions>
  check?(request: BotChannelSharedRequest<BotChannelValuesOf<S>>): Promise<BotChannelCheck>
  inspect?(request: BotChannelSharedRequest<BotChannelValuesOf<S>>): Promise<BotChannelInspection>
}

interface BotChannelSharedRequest<SV> {
  readonly shared: SV
  readonly signal: AbortSignal
}

interface BotChannelSettingsRequest<V, SV = Readonly<Record<string, never>>> {
  readonly bot?: { readonly id: string; readonly name: string }
  readonly settings: V
  readonly shared: SV
  readonly signal: AbortSignal
}

interface BotChannelLink<V, SV = Readonly<Record<string, never>>> {
  readonly shared: SV
}
```

- チャネル全体のフィールドの種類・検査・`clears`・`agent`（ボットに見せるか）はボットごとのフィールドと同じ（`checkChannelDescriptor` を同じく通す）。ただしチャネル全体の設定はボットの `bot_settings`（docs/specs/bot-settings.md）の領域に **出さない**（ボット 1 体が全ボットの設定を変えられないように）ので、`BotChannelShared` のフィールドは `agent` を持たない型 `BotChannelSharedField`（各種類から `agent` を除いたもの）にする。
- ボットごとの `options` / `check` / `inspect` / `connect` は、チャネル全体の値（秘密を含む）を `shared` として受け取る。チャネル全体の設定が無いチャネルでは `shared` は空のオブジェクト。
- **準備ができているか**: ボットごとの readiness の前に、チャネル全体の readiness（必須の項目と秘密がそろっているか）を見る。そろっていなければ、そのチャネルのどのボットも `{ state: "unconfigured" }`（`BotChannelStatus` に足す）で、接続しない。画面は「dsh-bots の設定で <チャネル名> を設定してください」と全体設定の該当セクションを開くボタンを出す。
- **revision**: `ChannelHub` の接続の鍵の revision は「ボットごとの revision」と「チャネル全体の revision」の組。チャネル全体を保存すると（値でも秘密でも）、そのチャネルの全ボットが繋ぎ直す。
- **検査**: チャネル全体の保存の前に `shared.check` を呼ぶ（ボットごとと同じく、有効な形で必須がそろったときだけ。断られたら保存しない）。ボットごとの `check` はチャネル全体がそろっていないときは呼ばない（`unconfigured` で済む）。
- **補足の拡張**: `BotChannelInspection`（ready）に `snippets?: readonly { label: BotChannelText; language: "yaml" | "text"; text: string }[]` を足す。画面はコードブロックとコピーのボタンで出す。秘密を入れないのはチャネルの責任（Matrix は雛形に `<as_token>` を残す）。
- **設定の移行**: チャネル全体にも `settingsVersion` と `upgradeSettings`（ボットごとと同じ規則、`checkChannelHooks` で検査）。

### 3.2 新しいボットで既定でオン

```ts
interface BotChannelInitialRequest<SV> {
  readonly bot: { readonly id: string; readonly name: string; readonly language: string }
  readonly shared: SV
  readonly signal: AbortSignal
}

type BotChannelInitial =
  | {
      readonly state: "ready"
      readonly values: BotChannelPublicValues
      readonly secrets: Readonly<Record<string, string>>
      readonly profileSync: boolean
      readonly summary: BotChannelText
    }
  | { readonly state: "unavailable"; readonly reason: BotChannelText }
```

- **だれが決めるか**: 「新しいボットでオンにするか」は bot-core がチャネル全体の設定として持つ `newBots: boolean`（テーブル `shared` の同じ行、既定 `false`）。全体設定のチャネルのセクションにスイッチを出す。`initialSettings` を持つチャネルにだけ出す（持たないチャネルにスイッチは無い）。「何で埋めるか」はチャネルが `initialSettings` で返す（Matrix は `home: "dm"`、`approvers: [defaultOwner]`、`language` はボットの言語が `ja` で始まれば `ja`、それ以外は空、`profileSync: true`、`summary` は「@alice:example.org との DM」）。
- **申し出**: Remote `botChannels.defaults()` が、`newBots` がオンでチャネル全体がそろっているチャネルの一覧 `{ channelId, name, summary }` を返す。`summary` は `BotChannelShared` に足す `describeInitial(shared): { state: "ready"; summary: BotChannelText } | { state: "unavailable"; reason: BotChannelText }` が、ネットワークに出ずに保存済みの値だけから作る（Matrix は `defaultOwner` が空なら `unavailable`）。`unavailable` のチャネルは一覧に理由付きで出し、選べない。
- **New bot ダイアログとウィザード**: 「ボットと一緒に設定」に、申し出のチャネルを「Matrix: @alice:example.org との DM でオン」としてチェックボックス（既定でチェック）で並べる。外したチャネルは自動でオンにしない。`BotCreateInput` に `channels: readonly string[]`（自動でオンにするチャネル id）を足す（必須。検査は `validateCreationChoices` と同じ場所）。ウィザードで下書きを入れたチャネル（`createBot(input, channels)` の `channels`）は下書きが優先で、同じチャネルを両方に入れたら `gateway/bad-request`。
- **どこで当てるか**: Host の `lifecycle.create`（`bots.create` とウィザードの `createBot` の両方が通る）の中、ボットの記録を保存した直後（Main を待たない。ウィザードの下書きを保存するのと同じ時点）に、`host/channels/initial.ts` が `BotCreateInput.channels` のチャネルごとに `initialSettings` を呼び、`panel.configure`（`check` を含む同じ道）で `enabled: true` として保存する。作成の時点で申し出が無くなっていた（`newBots` がオフになった、チャネル全体がそろわない）チャネルは、次の「失敗したとき」と同じく理由を記録する（黙って飛ばさない）。
- **失敗したとき**: ボットの作成は失敗にしない（チャネルはボットの本体ではない）。そのチャネルは保存しない（オフのまま）。チャネルの記録に `initial: { state: "failed", reason, at }` を残し（`ChannelRecord` の任意のフィールド、`enabled: false`）、ボットの Channels のそのチャネルの見出しの下に「自動でオンにできませんでした: <理由>」を出す。次にそのチャネルを保存したら消す。warn にも出す。やり直しは人が Channels でオンにする（中身は空から。自動で埋め直す道は作らない）。
- `initialSettings` に答える時間は 15 秒（`CHANNEL_QUERY_MS`）。`initialSettings` が返す値は `parseChannelChange` で検査してから使う（チャネルの答えも信用しない）。

### 3.3 ボットごとのアカウント

```ts
interface BotChannelAccounts<SV> {
  reconcile(request: {
    readonly listed: (botId: string) => boolean
    readonly shared: SV
    readonly signal: AbortSignal
  }): Promise<void>
}
```

- **用意** はチャネルの `connect` の中でする（接続の最初の手順。冪等）。bot-core は用意を知らない。チャネルは用意の進みを `report({ state: "connecting" })`、失敗を `failed`（理由）で知らせる。アカウントの id（MXID）が要る `options` / `inspect` は、チャネルがボットの id から決まった形で作る（状態を持たない）。
- **後片付け** は `reconcile`。bot-core が、チャネル全体がそろっているときに、(a) チャネルが登録されたとき、(b) ボットの一覧が変わったとき（削除を含む）、(c) チャネル全体の設定が保存されたときに呼ぶ。チャネルは自分の記録のうち `listed` が偽のボットのアカウントを片付ける。失敗はチャネルが記録に残し、次の `reconcile` でやり直す（bot-core は warn にするだけ）。チャネル全体がそろわないあいだは呼ばない（片付けに秘密が要るため）。同時には 1 つしか走らせない（走っている間に来た呼び出しは、終わった後に 1 回にまとめる）。
- ボットの削除は `reconcile` を待たない（homeserver が落ちていてもボットは消える）。チャネルの設定と秘密は今までどおり `purge` で消え、アカウントの記録はチャネル（Matrix の `accounts`）に `retiring` で残る。
- チャネルをオフにしてもアカウントは片付けない（オンに戻せば同じアカウント・同じ DM で続く）。
- **名前とアバター** は `feat/channel-profile` の `profile` 出力と `profileSync` を使う（別の仕組みを作らない）。Matrix は `capabilities.profile: { name: true, avatar: true }` を宣言し、`initialSettings` で `profileSync: true` を返す。Channels で `profileSync` を切れば、Matrix の名前とアバターはそのまま残り、以後追わない。

### 3.4 画面

- **全体設定**: bot-core が、`shared` を持つチャネルごとにセクション（id `channel-<id>`、名前はチャネル名、`order` は Web lookup の後）を登録する（`client/channels-shared/`）。中身は、チャネル全体のフィールド（`ChannelGroup` の項目の部品をそのまま使う。保存先が違うだけ）、`newBots` のスイッチと「新しいボットは <summary> で自動でオン」の説明（`describeInitial` が `unavailable` なら理由）、`inspect` の行（アカウント、注意、リンク、`snippets`）。badge: チャネル全体がそろっていないのに、そのチャネルがオンのボットがある・`newBots` がオン、または `check` が断っている、なら `warning`。
- **ボットの Channels**: `unconfigured` の行（§3.1）と、`initial` の失敗（§3.2）を出す。`shared` を持つチャネルのボットごとのフィールドはそのまま。
- **ウィザード**: 初期設定の手順の「チャネル」で、`shared` を持つチャネルはボットごとの下書きの代わりに全体設定のセクションと同じ部品を出す（保存は Remote にすぐ。下書きにしない。全体の設定はボットが無くても保存できるので）。最初のボットのページの「ボットと一緒に設定」には §3.2 のチェックボックスが出る。

### 3.5 Remote `botChannels` に足すもの

| メソッド                             | 戻り値                           | 内容                                                                                                          |
| ------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `watchShared()`（stream）            | `BotChannelSharedSnapshot` の列  | `shared` を持つチャネルごとの `{ channel, values, secrets: Record<key, boolean>, newBots, status, revision }` |
| `configureShared(channelId, change)` | `BotChannelConfigureResult`      | `{ values, secrets, newBots }`。`shared.check` を通してから保存                                               |
| `defaults()`                         | `{ channelId, name, summary }[]` | §3.2 の申し出                                                                                                 |

- `options` / `inspect` / `check` の `settings` に `{ kind: "shared" }`（保存済み）と `{ kind: "shared-draft", values, secrets }`（入力中）を足す。そのときは `shared.options` / `shared.inspect` / `shared.check` を呼ぶ。ボットごとの ref（`bot` / `draft`）では、Host が保存済みのチャネル全体の値と秘密を `shared` に入れる（ブラウザから送らせない）。
- チャネル全体のステータス: `{ state: "incomplete", missing } | { state: "ready" }`。

### 3.6 保存と設計ルール（bot-core）

- `dsh_bot_channels` にテーブル `shared`（キー: チャネル id）を足す: `{ channelId, values, secrets: string[], newBots: boolean, settingsVersion?, updatedAt }`。`channels` の記録に任意の `initial`（§3.2）。テーブルの追加と任意のフィールドは互換の変更としてスナップショットを更新する（DSH の storageDomain がテーブルの追加を版の変更として要求するなら版 2・`compatibleVersions: [1]` にする。実装の最初に確かめる）。
- チャネル全体の秘密の record は `bot-core/shared-channel-<channelId>`（`host/channels/vault.ts` に `sharedVaultKey`）。ボットごとの `channel-…`、Web の `web-…`、接続の `connection-…` と重ならない。チャネルの登録が外れても消さない。
- 書くのは `host/channels/shared-settings.ts` だけ（新しい設計ルール: `shared.put/delete()`）。状態（記録・revision・購読）は `shared-settings.ts`、readiness と変更の計算は `shared/channels.ts` の純粋な関数（`missingChannelFields` を使い回す）。
- 設計ルール 16・17 はそのまま（Matrix プラグインは `credentials` を名指ししない。`as_token` は `link.shared` と request の `shared` でだけ受け取る）。

## 4. homeserver 実装の差し替え

### 4.1 方式（Application Service と identity assertion）

- 用意: `POST /_matrix/client/v3/register`（`as_token`、`{ type: "m.login.application_service", username: "<prefix>_<botId>", inhibit_login: true }`）。`M_USER_IN_USE` は「もうある」として進む（名前空間は exclusive なので作れたのは自分だけ）。`M_EXCLUSIVE` は「登録ファイルの名前空間にこの接頭辞が入っていない」として失敗にする。
- 以後のボットの要求はすべて `Authorization: Bearer <as_token>` と `user_id=<MXID>`（spec の identity assertion）。`/sync`、送信、リアクション、redaction、編集、typing、既読、プロフィール、メディアの upload / 認証付き download、部屋の作成・参加・退出、`m.direct`、ピンまで、Synapse と Tuwunel の両方で動いた（spike 3）。
- ボットごとの `/login`（`m.login.application_service`、MSC2778）も両方で動いた（spike 1）が使わない。理由: Synapse ではログインしたトークンの要求が普通のユーザーとして rate limit され（25 回の送信のうち 10 回目から 15 回が 429）、identity assertion の要求は `rate_limited: false` で外れた（spike 2）。ほかに、ボットごとのトークンを保存しなくてよい、`device_id` を付け忘れるとデバイスが増える（spike 2）問題が無い、Synapse の無効化は identity assertion でしか通らなかった（spike 1・2）。`as_token` はどちらの方式でも Host に要るので、守るものは増えない。
- 429 は `retry_after_ms`（無ければ 1 秒）待って同じ要求を送り直す（アダプターの中。上限 5 回で失敗）。

### 4.2 インターフェース

```ts
type MatrixServerKind = "synapse" | "tuwunel"

interface MatrixServer {
  readonly kind: MatrixServerKind
  readonly label: BotChannelText
  readonly registrationGuide: BotChannelText
  identify(api: MatrixApi, signal: AbortSignal): Promise<MatrixServerIdentity | undefined>
  retire(api: MatrixApi, account: MatrixAccountRef, signal: AbortSignal): Promise<MatrixRetirement>
}

interface MatrixServerIdentity {
  readonly kind: MatrixServerKind
  readonly version: string
}

type MatrixRetirement =
  | { readonly kind: "deactivated" }
  | { readonly kind: "vacated"; readonly note: BotChannelText }
```

- `host/servers/` に実装ごとに 1 ファイル（`synapse.ts`、`tuwunel.ts`）、`host/servers/index.ts` が `MATRIX_SERVERS: Readonly<Record<MatrixServerKind, MatrixServer>>`。全体設定の `server` の `choices` はここから作る。新しい実装は 1 ファイルとここへの 1 行で足せる。`MatrixApi` は §8 の Client-Server API のクライアント（実装ごとの拡張 API もここから呼ぶ）。
- 実装の違いで分岐するのは `MatrixServer` の中だけ。ほかのモジュールは `kind` を見て分岐しない（設計ルール、§8）。
- `identify`: Synapse は `GET /_synapse/admin/v1/server_version`（認証なし、`{"server_version":"1.166.0"}`）、Tuwunel は `GET /_tuwunel/server_version`（`{"name":"Tuwunel","version":"2.1.0"}`）。答えなければ `undefined`。全体設定の `check` は、選んだ実装の `identify` が答えないとき「<homeserver> は <実装> ではないようです」で断る（ほかの実装を試して当てはめない）。
- `retire`（§6.7 の後片付けの最後の段）:
  - Synapse: `POST /_matrix/client/v3/account/deactivate?user_id=…`（`erase: false`、UIA なし）。以後そのユーザーはログインもできず（`M_USER_DEACTIVATED`）、同じ localpart は二度と作れない（`M_USER_IN_USE`）。ボットの id は使い回されないので困らない。
  - Tuwunel: 無効化の道が無い（identity assertion の deactivate は `M_MISSING_TOKEN`、ボットのトークンでは UIA の flows が空で通らない。spike 1・2）。`vacated` を返し、アカウントは残る（部屋は出てプロフィールは消してある）。全体設定の補足に「Tuwunel では削除したボットの Matrix アカウントは無効化されません。必要なら管理者ルームで `!admin users deactivate <MXID>`」と出す。

### 4.3 Synapse と Tuwunel の違い（spike の結果）

| 項目                                                    | Synapse 1.166.0                                  | Tuwunel 2.1.0                                                     | 扱い                                                    |
| ------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------- |
| 登録ファイルの置き場所                                  | `app_service_config_files`、再起動               | `appservice_dir`・config の inline・`!admin appservices register` | `registrationGuide`                                     |
| AS の register / identity assertion                     | 動く                                             | 動く                                                              | 共通                                                    |
| 未登録の名前空間のユーザーとして要求                    | 403 `M_FORBIDDEN`                                | 200（暗黙に通る）                                                 | 共通の手順で必ず先に register する                      |
| register 時の表示名                                     | localpart                                        | localpart に ` 💕`（`new_user_displayname_suffix` の既定）        | 共通: register の直後に表示名をボットの名前にする       |
| ログインしたトークンの rate limit                       | かかる（`rc_message`）                           | かからなかった                                                    | 使わない（§4.1）                                        |
| 無効化（deactivate）                                    | identity assertion で通る                        | 通らない                                                          | `retire`                                                |
| 無効化した localpart の再作成                           | `M_USER_IN_USE`                                  | （無効化できない）                                                | localpart はボットの id で一意                          |
| `/sync` の `timeout`                                    | 頼んだとおり（2 秒→2.0 秒）                      | 5 秒未満は 5 秒に切り上げ（2 秒→5.0 秒）                          | 30 秒で頼むので影響なし                                 |
| 壊れた `since`                                          | 400 `M_UNKNOWN`                                  | 200（受け付ける）                                                 | 共通: 400 なら since を捨てる（§6.8）                   |
| 再起動後の `since`                                      | 使える。`limited` と `prev_batch` で穴埋めできる | 同じ                                                              | 共通                                                    |
| 認証なしの旧メディア `/_matrix/media/v3/download`       | 404                                              | 403                                                               | 認証付き `/_matrix/client/v1/media/download` だけを使う |
| 非同期 upload（`/_matrix/client/v1/media/create`）      | 無し（404）                                      | 無し（404）                                                       | `POST /_matrix/media/v3/upload` だけを使う              |
| アップロードの上限（`/_matrix/client/v1/media/config`） | 50 MiB（既定）                                   | 24 MiB（既定）                                                    | 接続のはじめに読む（§6.6）                              |
| 編集の集約（`unsigned["m.relations"]`）                 | ある                                             | 無い                                                              | 頼らない（カードの今の中身はボットが持つ）              |
| CS API の版（`/versions`）                              | v1.17 まで                                       | v1.19 まで                                                        | v1.11（認証付きメディア）以上を要る。`check` が確かめる |

## 5. ボットごとの設定

| キー        | 種類                              | 中身                                                                                                                                                                                                    |
| ----------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `home`      | pick（必須、`source: "home"`）    | `dm`、または部屋の id（`![A-Za-z0-9._~+/=:-]{1,254}`。room version 12 の id は `:server` を持たない）。`clears: ["approvers"]`。説明は Discord と同じく、部屋では中身がメンバー全員に見えることを書く。 |
| `approvers` | list（1〜10、`source: "owners"`） | オーナーの MXID（`@[a-z0-9._=/+-]+:[A-Za-z0-9.-]+(:[0-9]{1,5})?`、255 字）。DM ではちょうど 1 人。ラベルは「Owners / オーナー」。                                                                       |
| `language`  | text（choices）                   | Discord と同じ（空 / `en` / `ja`）。ホームでのボット自身の文言の言語。Matrix にはユーザーごとの言語が無いので、コマンドの答えと断りもこれに従う。                                                       |

- `settingsVersion` は 1。秘密のフィールドは無い（認証はチャネル全体の `asToken`）。
- **候補**（`options`。チャネル全体がそろっていて、ボットのアカウントを作る前でも答える。アカウントがまだ無ければ、部屋の候補は「DM」だけで、理由の行「ボットを部屋に招待するには、まず Matrix をオンにして接続してください」）:
  - `home`: 「ダイレクトメッセージ」と、ボットが参加している部屋・招待されている部屋（`/sync` の join と invite、暗号化されている部屋は除く）。ラベルは部屋の名前（無ければ `m.heroes` か id）、`detail` は「参加中 · 3 人」か「<招待した人> から招待」、画像は部屋のアバター（`/_matrix/client/v1/media/thumbnail` を Host が読んで data URL にする。https の URL ではないので `BotChannelOption.image` に data URL を許す変更を足す）。提案は `dm`。
  - `owners`: DM では、既定のオーナー（先頭）、保存済みのオーナー、ボットと部屋を共にする人（名前空間のユーザーは除く）。部屋では、その部屋のメンバー（join と invite、名前空間のユーザーは除く。既定のオーナーがいれば先頭）。ラベルは表示名、`detail` は MXID、画像はアバター。提案は既定のオーナー（いれば）。
- **検査**（`check`）: DM はオーナーがちょうど 1 人で、名前空間のユーザーでなく、`GET /profile/<MXID>` が答える（いない人を弾く）。部屋はボットが参加しているか招待されていて、暗号化されておらず、オーナーそれぞれが join か invite のメンバー。
- **補足**（`inspect`）: ボットの MXID（「この ID を部屋に招待すると、ホームの候補に出ます」）、アカウントの状態（まだ / 使用中）、DM の部屋（あれば `https://matrix.to/#/<roomId>`）、注意: 部屋でボットが `m.room.pinned_events` を送れない（承認待ちの一覧をピン留めできない）、部屋がほかのサーバーの人を含む（federation で中身がほかのサーバーにも渡る）。

## 6. Matrix の動き

### 6.1 接続

1. アカウントの用意（§4.1。記録 `accounts` に `active`）。新しく作ったときは表示名をボットの名前にする（アバターは `profile` 出力が来たとき）。
2. `GET /_matrix/client/v1/media/config` でアップロードの上限を読む。
3. ホームを決める:
   - 部屋: 招待されていれば参加する。参加も招待もされていなければ `failed`（「ボットはこの部屋にいません。招待してください」）。
   - DM: 記録 `homes` のオーナーとの DM の部屋を使う。無い、またはオーナーが出ていった（`leave` / `ban`）なら、ボットが作る（`createRoom` `preset: trusted_private_chat`、`is_direct: true`、`invite: [owner]`、暗号化なし）。`m.direct` のアカウントデータにも書く。オーナーが `is_direct` でボットを招待した部屋は、記録の DM にオーナーがいない（招待中のままを含む）ときだけ参加して DM にする。それ以外の招待は受けも断りもしない（部屋のホームの候補に出るだけ）。
4. `/sync` を回す（`timeout=30000`、フィルター: timeline は `m.room.message`、`m.reaction`、`m.room.redaction`、`m.room.member`、`lazy_load_members`、presence とアカウントデータなし）。最初の `/sync`（`since` が無い）は timeline `limit: 0` で、過去の発言は届けない。`connected` の報告はホームが決まって最初の `/sync` が返ったとき（`account` は MXID、`people` はオーナーの表示名と MXID）。

### 6.2 受け取る発言

- ホームの部屋の `m.room.message` だけ。DM ではオーナーの発言だけ。部屋ではメンバー全員（名前空間のユーザー = ほかのボットとボット自身は除く）。
- 種類: `m.text`、`m.emote`（「* 名前 本文」にして届ける）、`m.image`、`m.file`、`m.audio`、`m.video`（添付 1 つの発言。本文があれば caption として本文にする）。`m.notice`（ボットの慣習）と、`m.replace` の編集、redaction、`m.relates_to.rel_type: m.thread` のスレッドの発言は捨てる（スレッドは対象外）。
- 返信の fallback（本文先頭の `> <@…>` の行と `<mx-reply>`）は取り除く。開いているカードへの返信は届けず、カードの答えとして扱う（§6.5）。
- 届いたら 👀、届けられなかったら ⚠️ と理由の返信（Discord と同じ）。届けたら既読（`m.read`）を送る。
- 見出しの場所: DM は `DM`、部屋は `#<部屋の名前> (<server_name>)`（`BotMessagePlace` の `channel`）。送り主は表示名（部屋のメンバーの `displayname`）と handle（MXID）。

### 6.3 出すもの

| 出力                                             | 送るもの                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| 返信                                             | `m.text`（`body` は Markdown のまま、`format: org.matrix.custom.html` と `formatted_body`）                                     |
| ターンの通知（失敗・停止）、コマンドの答え、断り | `m.notice`                                                                                                                      |
| ファイル                                         | upload して `m.image`（PNG・JPEG・GIF・WebP を中身で判別）か `m.file`。caption は `body`、名前は `filename`（v1.10 の caption） |
| 入力中                                           | `PUT /typing`（`timeout: 30000`、20 秒ごとに送り直す、終わりで `typing: false`、返信の後は Discord と同じく 1.5 秒で再開）      |
| カード                                           | §6.5                                                                                                                            |
| ログイン情報の漏洩                               | `m.text` の報告（Discord と同じ中身、1 回だけ）                                                                                 |
| 名前とアバター（`profile`）                      | `PUT /profile/…/displayname`、アバターの PNG を upload して `avatar_url`。`reportProfile` で `synced` / `failed`                |

- どのイベントにも `"m.mentions": {}` を付ける（人を呼ばない。Discord の `allowed_mentions: { parse: [] }` と同じ）。
- 書式: `formatHint` は「Markdown renders, tables included; no raw HTML.」。Markdown → HTML は `host/format/` で `markdown-it`（`html: false`、`linkify: true`）。出す HTML は Matrix の推奨するタグの範囲（`markdown-it` が出すもの）だけで、生の HTML は文字として出る。
- 分割: Markdown で 16,000 字ごと（段落・行・コードブロックの境で切り、コードブロックは閉じて開き直す。Discord の `split.ts` と同じ考え）。イベントの上限 65,536 バイト（spike 3 で 70,000 字は `M_TOO_LARGE`）に `body` と `formatted_body` の両方が入るため。
- 送れなかったファイル・返信は、Discord と同じく出力の失敗として bot-core に返す。

### 6.4 コマンド

- ホームで、本文全体が `!stop`、`!status`、`!new`、`!pending`、`!help`（大文字小文字を区別しない、前後の空白は無視）の発言はコマンドとして扱い、Main に届けない。それ以外の `!` で始まる発言は普通の発言。Element などの `/` は クライアントが自分のコマンドとして解釈するので使わない。
- 答えは `m.notice` の返信。誰が実行できるかは `BotCommandSpec.access`（`owners` なら照らすのはオーナー）。`!pending` はオーナーだけで、答え（承認待ちの一覧）はホームの全員に見える（Matrix に「本人だけに見える」は無い。部屋のホームではもともと一覧が全員に見えるので同じ）。`!help` はコマンドの一覧と説明（`language` の言語）。

### 6.5 カード（質問・承認・プラン確認・コネクターの操作）

ボタンの代わりに、ボットが自分で付けておくリアクション（押すと同じリアクションが送られる）と、カードへの返信で答えさせる。カードは `m.text` の 1 イベントで、状態が変わったら `m.replace` で書き換え、閉じたら結果を書いて、ボットが付けたリアクションを redaction で外す。

| カード                  | 本文                                                                         | 答え方                                                                                                                                                         | 答えられる人                    |
| ----------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 質問（1 問ずつ、`k/n`） | 見出し、問い、`1️⃣ label — description` の並び、答え方の案内、待ち時間        | 選択肢が 10 以下で 1 つ選びなら 1️⃣〜🔟 のリアクション。返信で番号（複数選びは `1,3`）、番号でない返信は自由な答え、`-` はスキップ。⏸️ で待ちを止める（`hold`） | DM はオーナー、部屋は誰でも     |
| 承認                    | 主題、問い、詳細                                                             | ✅ 一度だけ許可、🔁 いつも許可（あれば）、❌ 断る                                                                                                              | オーナー                        |
| プラン確認              | 問い、プラン（長ければ分割した続きの `m.text`）                              | ✅ 承認、❌ 却下。返信の本文は「却下と、その理由（feedback）」                                                                                                 | オーナー                        |
| コネクターの操作        | Discord と同じ中身（操作、引数の要約、期限）                                 | ✅ 承認、❌ 却下（`link.decide`）                                                                                                                              | オーナー（bot-core が確かめる） |
| 承認待ちの一覧          | 待っている操作とカードへのリンク（`https://matrix.to/#/<roomId>/<eventId>`） | 答えない。ピン留めする（できなければ注意だけ、§5 の補足）                                                                                                      | —                               |

- 質問の下書き（選んだ答え、今のページ）はカードに 1 つ（Discord の `draft.ts` と同じ。部屋では誰が答えても同じ下書きが進む）。最後の問いに答えたら `link.answer`。
- 答えられない人のリアクション・返信は無視し、カードごと・人ごとに 1 回だけ「オーナーだけが答えられます」の `m.notice` を返信する。ボット自身が付けたリアクションは数えない。
- どのカードの何への反応かは、メモリの `イベント id → カード` で引く（質問・承認・プラン確認）。Host の再起動の後は bot-core がカードを開き直す（`interaction-opened`）ので、新しいカードに答える。前のカードへの反応は無視する。コネクターの操作のカードと一覧は記録（§7）で引き、再起動の後も同じイベントに答えられる。

### 6.6 ファイルと添付

- 受け取り: `url` の `mxc://` を `GET /_matrix/client/v1/media/download/<server>/<id>`（identity assertion）で読む。`info.size` を大きさにし、読みながら `maxBytes` を超えたら止める（Discord の `download.ts` と同じ）。`capabilities.attachments` は `{ maxCount: 1, maxBytes: 100 MiB }`（Matrix の発言は添付 1 つ）。暗号化された添付（`file` キー）は来ない（暗号化された部屋はホームにしない）。
- 送り: `capabilities.files.maxBytes` は 100 MiB。実際の上限は接続のはじめに読んだ `m.upload.size`。超えるファイルはその出力を失敗にする（「homeserver の上限 24 MiB を超えています」）。

### 6.7 アカウントの後片付け（`reconcile`）

`accounts` の行で、ボットが一覧に無いものを `retiring` にし、次を順に行う（どの段も冪等。途中で失敗したら `retiring` のまま次の `reconcile` で続きから）:

1. 参加している部屋と招待をすべて出る（`/leave`、`/forget`）。
2. 表示名とアバターを消す。
3. `MatrixServer.retire`（Synapse は無効化、Tuwunel は `vacated`）。
4. 行を `retired` にし、`homes`、`cursors`、`cards`、`digests`、`incidents` のそのボットの行を消す。`retired` の行は残す（同じ MXID をもう使わない印。ボットの id は使い回されないので増えるだけで困らない）。

### 6.8 再接続と取りこぼし

- `since` はボットごとに記録 `cursors` に保存する。`/sync` の 1 回分の発言をすべて処理（届けた / 断った / 捨てた）してから次の `next_batch` を保存する（書いてから進む）。
- ホームの部屋の timeline が `limited` なら、`prev_batch` から `/messages`（`dir=b`）で、記録した最後の発言（`cursors.lastEventId`）まで遡り、古い順に届ける（spike 4: オフラインの間の 5 件のうち 3 件が `/sync`、2 件が `/messages` で取れた）。遡るのは 200 件まで。それより前は届けず warn にする。
- 1 回だけ届けること: 届けた発言の id を `lastEventId` と、直近 200 件の id の集合（メモリ）で照らす。
- `since` が 400 で断られたら（Synapse の `M_UNKNOWN`）、`since` を捨てて最初の `/sync` と同じく過去を届けずに始め、warn にする。
- 接続できない・5xx は 1 秒から倍々で 60 秒まで待って繰り返す（`connecting` を報告）。`as_token` が断られた（401 `M_UNKNOWN_TOKEN`）ら `failed`（「AS のトークンが homeserver の登録ファイルと合いません」）で、設定が変わるまで繰り返さない。

## 7. 保存

- storage domain `dsh_bot_matrix`（版 1、`invalidRecords: backup-and-skip`）。書くのは `host/records/` のテーブルごとのモジュールだけ（新しい設計ルール）。

| テーブル    | キー                   | 中身                                                                                                                                                               |
| ----------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accounts`  | `<botId>`              | `{ botId, userId, serverName, state, retirement?, createdAt, updatedAt }`。`state` は `active` / `retiring` / `retired`、`retirement` は `deactivated` / `vacated` |
| `homes`     | `<botId>`              | `{ botId, owner, roomId, updatedAt }`（DM の部屋。部屋のホームは設定にあるので記録しない）                                                                         |
| `cursors`   | `<botId>`              | `{ botId, since, roomId, lastEventId?, updatedAt }`（`roomId` が今のホームと違えば `lastEventId` を使わない）                                                      |
| `cards`     | `<botId>:<actionId>`   | `{ botId, actionId, roomId, eventId, seeds: string[] }`（`seeds` はボットが付けたリアクションのイベント id）                                                       |
| `digests`   | `<botId>`              | `{ botId, roomId, eventId, pinned: boolean }`                                                                                                                      |
| `incidents` | `<botId>:<incidentId>` | `{ botId, incidentId, roomId, eventId }`                                                                                                                           |

- ホームを変えたときの記録の扱いは Discord（版 3）と同じ: 接続のはじめに、そのボットの記録のうち今のホームの部屋のものだけを追い、ほかは忘れてホームに出し直す。

## 8. パッケージの形とライブラリ

- `packages/dsh-bot-matrix`（`@1outres/dsh-bot-matrix`、`inject: ["bot", "storageDomain"]`、バンドル `@1outres/dsh-bots` に入れる）。

| 場所                                                | 役割                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                                      | 配線（storage、タイマー、`fetch`、`registerChannel`）                                                                                                  |
| `host/channel.ts`                                   | `BotChannel` の宣言（フィールド、capabilities、hooks）                                                                                                 |
| `host/fields.ts`、`host/shared-fields.ts`           | ボットごととチャネル全体のフィールド                                                                                                                   |
| `host/matrix.ts`                                    | アダプターのポート（`MatrixApi`: 型付きの要求と答え、`MatrixSync`: 1 回分の `/sync` の正規化した結果）。Discord の `discord.ts` にあたる               |
| `host/client-server/`                               | **アダプター**: Client-Server API の薄いクライアント（`fetch` を受け取る、identity assertion、429 の待ち、エラーの分類、信用しない JSON の検証は zod） |
| `host/servers/`                                     | §4.2 の実装ごとの差                                                                                                                                    |
| `host/accounts.ts`                                  | 用意と後片付けの手順（状態は `host/records/accounts.ts`）                                                                                              |
| `host/sync-loop.ts`、`host/catch-up.ts`             | `/sync` の繰り返し、穴埋め、`since` の保存                                                                                                             |
| `host/bridge.ts`、`host/inbound.ts`、`host/home.ts` | Discord と同じ分け方（出力の振り分け、受け取る発言、ホーム）                                                                                           |
| `host/cards/`                                       | 質問・承認・プラン確認の描画（純粋）と答えの読み取り（純粋）、presenter                                                                                |
| `host/actions/`、`host/incidents/`                  | コネクターの操作と漏洩（Discord と同じ構成）                                                                                                           |
| `host/format/`                                      | Markdown → HTML（`markdown-it`）、分割                                                                                                                 |
| `host/settings/`                                    | `options` / `check` / `inspect` / `initialSettings` / `describeInitial`                                                                                |
| `host/records/`                                     | §7 のテーブル                                                                                                                                          |

- **ライブラリは使わず、自前の薄いクライアントにする**。使う API は spike で確かめた 25 ほどのエンドポイントだけで、E2EE が無い。`/sync` の `since` と穴埋めを自分で持ちたい（永続化と 1 回だけ届けることを bot-core の規則で決めたい）。テストは偽の `fetch` で、Exa の `client.ts`（docs/specs/bot-web.md §4）と同じ作り。
  - matrix-js-sdk 45.2.0: 依存 17、`node_modules` 28 MB（`@matrix-org/matrix-sdk-crypto-wasm` を含む）、ESM。クライアントの状態（ルーム、タイムライン、ストア）を丸ごと持つ作りで、`since` の保存と穴埋めをこちらの規則で持ちにくい。`queryParams` で identity assertion はできる。
  - matrix-bot-sdk 0.8.0（最終更新 2026-01）: 依存 167、非推奨の `request`、`express`、ネイティブの `@matrix-org/matrix-sdk-crypto-nodejs`。`Appservice` は HTTP の受け口が前提（`url: null` と合わない）。
- 新しい設計ルール（`docs/design-rules.md` に足す）:
  - `fetch`（グローバル）と `node:http(s)` は `packages/dsh-bot-matrix/src/host/client-server/` と `src/index.ts` だけ（Discord のルール 33 にあたる）。`markdown-it` は `host/format/` だけ。
  - `host/servers/<kind>.ts` を import できるのは `host/servers/index.ts` だけ。`MatrixServerKind` のリテラル（`"synapse"`、`"tuwunel"`）は `host/servers/` の外に書かない。
  - `accounts` / `homes` / `cursors` / `cards` / `digests` / `incidents` の `.put/delete()` は `host/records/` だけ（ルール 72 にあたる）。
  - `node:fs`、`node:child_process` を import しない（ルール 35 にあたる）。ルール 8 の例外に `packages/dsh-bot-matrix/src/index.ts` を足す。ルール 18・19（`dsh-bot-matrix` と id `matrix`）はそのまま当てはまる。

## 9. 対象外

- E2EE、暗号化された部屋、スレッド、ホームが 2 つ以上、スペース、通話。
- homeserver の自動判別（実装は人が選ぶ）、`.well-known` の解決、OIDC（MAS）だけの homeserver の確認（identity assertion は MAS と関係なく動く見込みだが確かめていない）。
- AS の HTTP の受け口（`url` を持つ登録）、ボットごとのログイン（§4.1）。
- Synapse の shared secret 登録 + Admin API、登録トークンでのアカウント作成（§11 の比較の結果、AS で両方動いたので作らない。新しい `MatrixServer` が要れば足す）。
- Discord の `shared` / `initialSettings` / `accounts`（Discord はボットごとにトークンを人が作るので、今は使わない）。
- Matrix の中から設定を変えること。

## 10. 実装の順序

1. `feat/channel-profile` が main に入るのを待つ。
2. bot-core: §3 の contract（`shared`、`initialSettings`、`describeInitial`、`accounts`、`unconfigured`、`snippets`、data URL の候補の画像）、`host/channels/shared-settings.ts`、vault の鍵、hub の readiness と revision、`host/channels/initial.ts` と `lifecycle.create` の配線、`BotCreateInput.channels`、Remote、設計ルール、スナップショット。テスト（純粋な関数は表で、hub・settings・initial は偽のチャネルで）。
3. bot-core の画面: 全体設定のチャネルのセクション、Channels の `unconfigured` と自動でオンの失敗、New bot ダイアログとウィザードのチェックボックス、ウィザードのチャネル全体の部品。
4. `dsh-bot-matrix`: アダプター（偽の `fetch` でテスト）→ servers → accounts → sync とホーム → 受け取りと出力 → カード → コネクターの操作と漏洩 → 設定の hooks。設計ルールとそのフィクスチャ。README（全体設定と登録ファイルの手順、実装ごとの案内）。
5. 確認: `/tmp` に立てた確認用の DSH と、使い捨てのコンテナの Synapse・Tuwunel（spike と同じ作り）で、Playwright で全体設定 → 新しいボット → オーナーのアカウント（Element Web か curl）で DM に参加 → 発言・ファイル・カードの答え・コマンド → ボットの削除と後片付け、を両方の実装で通す。

## 11. spike で確かめたこと

作者の環境での記録（2026-11-26）。使い捨ての incus コンテナ `matrix-spike`（`images:debian/13`、Node 20.19.2）に Synapse 1.166.0（packages.matrix.org の trixie、`server_name: synapse.test`、:8008）と Tuwunel 2.1.0（GitHub Releases の `x86_64-v1` の .deb、`server_name: tuwunel.test`、:8009、federation なし）を入れ、上の雛形と同じ登録ファイル（`url: null`、`rate_limited: false`、`@dshbots_.*` を exclusive）を Synapse は `app_service_config_files`、Tuwunel は `appservice_dir` で読ませた。スクリプトは `/tmp/matrix-spike/as-spike{,2,3,4}.cjs`（Node の `fetch` だけ）。検証の後、コンテナを消した。

1. **AS の基本**（両方 OK）: 名前空間のユーザーは普通の `/register` で作れない（`M_EXCLUSIVE`）。AS の register は通り、2 回目は `M_USER_IN_USE`、名前空間の外は `M_EXCLUSIVE`。`GET /login` の flows に `m.login.application_service` があり、AS のログインで `device_id` 付きのトークンが出た。同じ `device_id` で 2 回ログインしても前のトークンは使えた。`as_token` だけの `whoami` は送り主 `@dshbots:<server>`。表示名・アバター（upload → `avatar_url`）・プロフィールの読み取り、DM の作成（`trusted_private_chat`、`is_direct`、暗号化なし）と `m.direct`、オーナーの参加、`joined_members`、フィルター付きの `/sync`（最初と差分）、オーナーの `m.text` と `m.file` の受け取り、認証付きの download（トークンなしは 401 `M_MISSING_TOKEN`）と thumbnail、リアクション、既読、typing、HTML の `formatted_body`、`m.replace` の編集、`m.in_reply_to` の返信、redaction、DM でのピン、ボットの `m.file` の送信、オーナーのリアクションと返信の受け取り、オーナーの部屋への招待が `/sync` の invite に出ること、退出、`logout` でトークンが無効になること。失敗: 旧メディアの認証なし download（Synapse 404、Tuwunel 403）、`/_matrix/client/v1/media/create`（両方 404）。Synapse では、この後の参加・`/members`・退出が 429 になった（5 で確かめ直した）。
2. **rate limit とアカウント**: 25 回続けて送ると、Synapse はログインしたトークンで 10 回目から 15 回が 429、identity assertion では 0 回。Tuwunel はどちらも 0 回。identity assertion の `/sync` と参加は両方 OK。無効化: Synapse は identity assertion で 200（以後ログインは 403 `M_USER_DEACTIVATED`、同じ localpart の register は `M_USER_IN_USE`）。Tuwunel は identity assertion で 401 `M_MISSING_TOKEN`、ボットのトークンでは UIA の flows が空で、`m.login.application_service` も `m.login.dummy` も通らなかった（以後もログインできた）。`device_id` なしで 2 回ログインするとデバイスが 2 つ増えた（両方）。`/messages` は両方 OK。70,000 字の本文は両方 413 `M_TOO_LARGE`。
3. **identity assertion のエンドポイント**（両方すべて 200）: 表示名、upload、認証付き download、アバター、部屋の作成、相手の参加、`m.direct`、送信、typing、既読、リアクション、redaction、ピン、`joined_members`、フィルター、`/sync`、長い `/sync`（`timeout=2000` で Synapse 2.0 秒、Tuwunel 5.0 秒）、`whoami`、退出、`forget`、表示名を消す。未登録の名前空間のユーザーでの要求は Synapse 403、Tuwunel 200。`/appservice/<id>/ping` は両方 `M_URL_NOT_SET`（`url: null` なので期待どおり。疎通の確認には使えない）。違う `as_token` は 401 `M_UNKNOWN_TOKEN`。実装の判別: `/_synapse/admin/v1/server_version` と `/_tuwunel/server_version`（`/_conduwuit/server_version` は無い）。`/versions` は Synapse v1.17、Tuwunel v1.19 まで。
4. **再起動と取りこぼし**（両方同じ）: `since` を保存 → オーナーが 5 件送る → 両方のサーバーを再起動 → 保存した `since` で `timeline.limit=3` の `/sync` は後の 3 件と `limited: true`、`prev_batch` からの `/messages`（`dir=b`）で残りの 2 件が取れた。壊れた `since` は Synapse 400 `M_UNKNOWN`、Tuwunel 200。
5. **招待とパワーレベル**（429 を `retry_after_ms` で待って再試行）: 両方で、招待の受諾、`/members`、部屋の名前が OK。オーナーの作った部屋（`private_chat`、ボットは PL 0、`state_default: 50`）ではピンは 403 `M_FORBIDDEN`。オーナーが `is_direct` で作った DM の招待は、ボットの member イベントに `is_direct: true` が付いて届く（普通の部屋の招待には付かない）。Tuwunel は register 時の表示名に ` 💕` を付ける。
6. **代わりの方式との比較**: Synapse の shared secret 登録（`/_synapse/admin/v1/register`、HMAC）と Tuwunel の登録トークン（`m.login.registration_token`）は、spike のオーナーのアカウントを作るのに使って動いた。どちらも名前空間を守れず（誰でも同じ形の名前を取れる）、ボットごとにトークンかパスワードを持つことになり、Synapse では rate limit がかかり、無効化は管理者のトークンが要る。AS が両方で動いたので、これらは作らない（§9）。
7. **ライブラリ**（Host の `/tmp/matrix-spike/libs` に `--ignore-scripts` で入れて中身だけ見た。サーバーに繋いではいない）: §8 のとおり。

## 12. 未決事項（決定済み）

ユーザが 3 つとも仕様書どおりで承認した（2026-11-27）。

- 要求はすべて AS のトークンと identity assertion（`user_id`）で送る（§4.1）。ボットごとのログインはしない。
- Tuwunel で削除したボットのアカウントは、部屋を出てプロフィールを消すだけ（`vacated`）。
- ホームを変えたとき・オフにしたときは前の部屋に残り、ボットを削除したときだけ出る。

## 13. 実装で確定したこと

**bot-core のチャネル contract**（`shared/channels.ts`、`channel-contract.ts`）

- フィールドの型を 2 段にした: `BotChannelShared{Secret,Text,Pick,List}Field`（`agent` なし）と、それに `agent` を足した今までの `BotChannel*Field`。値の検査・空の値・欠けている項目・変更の解析（`parseChannelChange` ほか）は `BotChannelSharedField` を取るので両方に使える。チャネル全体のフィールドは `checkSharedChannelFields` で検査し、`agent` を持つと登録で断る。
- `BotChannel<F, S>` に `shared?: BotChannelShared<S>`（`fields`、`description?`、`settingsVersion?`/`upgradeSettings?`、`options?`/`check?`/`inspect?`、`describeInitial?`）、`initialSettings?`、`accounts?: { reconcile }` を足した。ボットごとの request と link は `shared`（秘密を含む値）を必ず持つ（チャネル全体の設定が無いチャネルでは `{}`）。`registerChannel<F, S = readonly []>`。
- 登録時の検査（`checkChannelHooks`）: `initialSettings` と `shared.describeInitial` は両方あるか両方ないか、`initialSettings`・`accounts` は `shared` が要る、`source` を持つ全体のフィールドには `shared.options` が要る、全体の `settingsVersion` が 2 以上なら `upgradeSettings` が要る。
- `describeInitial(shared)` には秘密を空にした値を渡す（保存済みの値だけで、ネットワークに出ずに答えるため）。
- `BotChannelStatus` に `unconfigured`、`BotChannelView` に `initial?: { state: "failed", reason, at }`、`BotChannelInspection`（ready）に `snippets?`、`BotChannelSettingsRef` に `shared` / `shared-draft`、`BotChannelDescriptor` に `shared?: true`（ウィザードが下書きの代わりに全体の部品を出すため）。全体の画面用に `BotChannelSharedView`（`channel`、`values`、`secrets`、`newBots`、`initial?`（`describeInitial` の答え、そろっているときだけ）、`status`、`enabledBots`、`revision`）。
- 候補の画像（`BotChannelOption.image`）は https の URL か `data:image/(png|jpeg|gif|webp);base64,…`（`CHANNEL_OPTION_IMAGE`）。Matrix の部屋とメンバーのアバターは Host が 64px のサムネイルを読んで data URL にする。
- `BotCreateInput.channels: readonly string[]` は必須（`parseInitialChannels`、`shared/channels.ts`。重複とチャネル id の形を断る）。ウィザードの `createBot(input, channels)` で同じチャネルを下書きと `input.channels` の両方に入れたら `gateway/bad-request`。

**bot-core の Host**

- 保存: `dsh_bot_channels` にテーブル `shared`（`{ channelId, values, secrets, newBots, settingsVersion?, updatedAt }`）と、`channels` の記録に任意の `initial`。DSH の storage domain は無いテーブルを空として読む（`dsh-storage-json` を確かめた）ので、版は 1 のまま。スキーマのスナップショットのテスト（設計ルール 27）は、前の版に無かったテーブルの必須フィールドを「壊す変更」に数えないようにした（そのテーブルの記録はまだ無いため）。
- 秘密は `bot-core/shared-channel-<channelId>`（`sharedVaultKey`）。書くのは `host/channels/shared-settings.ts` だけ（設計ルール 80、`shared.put/delete()`）。保存のたびにチャネルの revision を上げる。
- `host/channels/shared-panel.ts`: 全体のスナップショット、保存（`shared.check` はそろっているときだけ。断られたら `{ saved: false, reason }`）、申し出（`defaults()`）、全体の `options`/`inspect`/`check`。`newBots` を `initialSettings` の無いチャネルで立てる変更は断る。`defaults()` は `newBots` がオンのチャネルを全部返し、そろっていないものは `unavailable`（「先に dsh-bots の設定で…」）で返す（画面は選べない行として出す）。
- hub: 全体がそろわないチャネルはどのボットも接続しない。接続の鍵の revision は `"<ボット>:<全体>"` の文字列。panel: オフでなく全体がそろわないボットは `unconfigured`。そのあいだボットごとの `options`/`inspect` は `unavailable`（同じ理由）、`check` は呼ばない（保存も検査なしで通る）。
- 新しいボット: `lifecycle.create` が `registry.create` の直後に `host/channels/initial.ts` を待つ（ボットの作成は失敗にしない。各チャネルは 15 秒まで）。`initialSettings` の答えは `parseChannelChange` を通し、`panel.configure` で保存する（`check` を含む）。申し出が無い・`unavailable`・断られた・例外のときは `markInitialFailed` で `enabled: false` と `initial` を記録し warn にする。次の保存で `initial` は消える。資格情報ストアが無い（チャネルの仕組みが動いていない）ときは warn だけ（`createInitialChannelsGate`）。
- アカウントの後片付け: `host/channels/accounts.ts`。チャネルの登録・設定の移行の後、ボットの一覧が変わったとき、全体の設定を保存したときに呼ぶ。チャネルごとに 1 つだけ走らせ、その間の呼び出しは 1 回にまとめる。全体がそろわないあいだは呼ばない。
- `bot:status` の行は `unconfigured` を「not set up in dsh-bots settings yet」と出す。

**bot-core の画面**

- 全体設定: Remote `watchShared` を接続の世代に合わせて購読し直す feed（`client/channels-shared/model.ts`、`followStream`）から、`shared` を持つチャネルごとに section `channel-<id>`（order 150、Web lookup の 100 の後）を登録・解除する。中身は `SharedChannelGroup`: 見出しと状態、ボットごとと同じ項目の部品（`ChannelFields`。`ChannelsSection.tsx` から切り出した）、「新しいボットでオンにする」（`initial` を持つチャネルだけ。オンでそろっていなければ「上の設定がそろうまで効きません」、そろえば「新しいボット: <summary>」）、`inspect` の行。badge は、そろっていないのにオンのボットがある・`newBots` がオンのとき `warning`。`check` の今の答えは badge に入れていない（保存のときにしか聞かないため。保存は断られれば残らないので、保存済みの設定は保存の時点では通っている）。
- `inspect` の `snippets` はコードブロックとコピーのボタンで出す（ボットごとの Channels でも同じ）。必須の選択肢（`choices`）が未保存のときは「選んでください…」を先頭に出す（先頭の選択肢が選ばれて見えて保存されない問題があったため）。
- ボットの Channels: `unconfigured` は「先に dsh-bots の設定で <チャネル> を設定してください」と全体設定の該当 section を開くボタン、自動でオンの失敗は「自動でオンにできませんでした: <理由>」の行。
- New bot ダイアログとウィザード: 「ボットと一緒に設定」に `defaults()` を Switch で並べる（`ready` のものは既定でオン、`unavailable` は理由付きで押せない）。ウィザードのチャネルの手順は `shared` を持つチャネルで `SharedChannelGroup` を出し（すぐ保存）、下書きの対象から外す。手順の見出しと説明を Discord 専用でない文言にした。

**Matrix**（`packages/dsh-bot-matrix`）

- 構成は §8 のとおり。`src/host/matrix.ts` が `MatrixApi`（ボットの MXID で `as()` した identity assertion の要求）とエラーの種類（`token`、`forbidden`、`not-found`、`user-in-use`、`exclusive`、`bad-since`、`too-large`、`unreachable`、`rejected`）。`src/host/client-server/` が `fetch` を受け取る実装（429 は `retry_after_ms`、無ければ 1 秒、5 回まで。答えは zod で検査し、読めないイベントは捨てる）。`src/host/servers/` が Synapse と Tuwunel（`MATRIX_SERVERS`、全体設定の `server` の choices もここから）。`src/host/records/` がテーブルごとの記録（設計ルール 84）。
- 設計ルール: 81（`fetch`・`node:http(s)` は `client-server/` と `src/index.ts` だけ）、82（`markdown-it` は `format/` だけ）、83（`servers/<kind>.ts` の import は `servers/index.ts` だけ、`"synapse"`/`"tuwunel"` の文字列は `servers/` の外に書かない）、84（Matrix の記録の書き込みは `records/` だけ）。ルール 35（`node:fs`・`node:child_process`）とルール 8 の例外（`src/index.ts`）を Matrix にも当てた。
- 全体の `check`: `/versions` に v1.11 以上、選んだ実装の `identify`、`whoami` の送り主の localpart が接頭辞、使用中のアカウントがあるときに server_name か接頭辞が変わらないこと、既定のオーナーが名前空間の外。全体の `inspect`: 送り主（アカウント）、登録ファイルの雛形（入力中の接頭辞と読めた server_name。読めなければ `<server_name>`）と実装ごとの置き場所の案内、Tuwunel の無効化できない注意、トークンが断られたらその理由。
- 実装を変えるときは、先に AS のトークンを消す（そろっていないあいだは検査しない）か、URL・実装・トークンを合わせて変える。1 つずつ保存すると、その途中の組み合わせを `check` が断るため（例: 実装だけ Tuwunel にすると「… は Tuwunel ではないようです」）。
- 接続: アカウントの用意（`register`、`M_USER_IN_USE` は「もうある」、記録が無いときか作れたときは表示名をボットの名前に）、アップロードの上限、ホーム（DM は記録の部屋にオーナーが join か invite でいればそれ、いなければ作る）、記録の引き継ぎ（今のホームの部屋の `cards`/`digests`/`incidents` だけ残す）。失敗は `failed` を報告して 1 秒から倍々で 60 秒まで繰り返す。トークンが断られた・登録ファイルの名前空間が合わない・部屋にいないときは繰り返さない。
- `/sync`: 最初（`since` なし）は `timeout=0`、timeline `limit: 0`。以後は 30 秒、`limit: 50`。1 回分を処理してから `cursors` に `since` と最後に処理したイベント（届けなかったもの・捨てたものを含む。穴埋めの止まる位置なので）を保存する。`limited` なら `prev_batch` から `/messages` で 50 件ずつ 200 件まで遡る。
- DM でオーナーが部屋を出た（leave / ban）ら、すぐ新しい DM を作ってホームにする。オーナーが招待中でないあいだに、オーナーから `is_direct` の招待が来たらそれに参加してホームにする。
- 書式: `markdown-it` は `html: false`、`linkify: true` に加えて `breaks: true`（チャットの改行をそのまま出すため）。16,000 字で分割。どのイベントにも `"m.mentions": {}`。
- カード: 質問は 1 問ずつ 1 つのイベントで、ページが変わったら `m.replace` で書き換え、ボットが付けたリアクションも付け直す（1 つ選びで選択肢が 10 以下のときだけ数字、待ち時間を数えているときだけ ⏸️）。複数選びは返信（`1,3`）だけ。プラン確認への返信は「差し戻しと、その理由」。閉じたら結果を書いてボットのリアクションを redaction で外す。答えられない人には、カードごと・人ごとに 1 回「オーナーだけが答えられます」の `m.notice`。メモリのカードの Map は記録と紛れないよう `showing` という名前にした（ルール 84 が名前で書き込みを見るため）。
- コネクターの操作: カードに ✅ ❌ を付け、記録（`cards`）で引く（再起動後も同じイベントに答えられる）。承認待ちの一覧はホームに 1 つ置き、`m.room.pinned_events` に足してピン留めする（断られたら warn にして、ピンなしで更新を続ける）。`!pending` はオーナーに一覧を返し、ほかの人には断りを返す。
- 名前とアバター: `accounts` の記録の `profile`（最後に反映した名前とアバターの digest）と違うときだけ送る。
- 受け取り: 送り主の表示名はプロフィールを読んで覚える（部屋のメンバーの表示名ではない）。部屋のホームの見出しの場所は `#<部屋の名前> (<server_name>)`（名前が無ければ部屋の id）。
- 後片付けの段 2 は表示名とアバターを空文字にする（Synapse で通った。Tuwunel では確かめていない）。Synapse で無効化したユーザーは `GET /profile` が `M_NOT_FOUND` になり、同じ localpart の `register` は `M_USER_IN_USE`。

**確かめたこと**（2026-11-27、`/tmp/dsh-matrix-verify` の確認用 DSH と、incus のコンテナ `dshb-matrix-verify` の Synapse 1.166.0・Tuwunel 2.1.0）

- ウィザードのチャネルの手順で Matrix の全体設定（Synapse）を入力して保存・検査が通り、登録ファイルの雛形に server_name が入る。「新しいボットでオンにする」をオンにすると最初のボットのページに「Matrix: @alice:synapse.test との DM でオン」が出て、作成でボットの Matrix ユーザーが作られ、DM が作られ、名前とアバターが反映され、言語は `ja`。
- オーナー（curl/スクリプト）が DM に参加して送ると 👀、既読、Main の返信が `m.text` で返る。モデルが使えないときの失敗の通知（`m.notice`）、`!status`、`!help`、添付ファイルの受け取り、質問カードへのリアクションの答え、承認カードへの ❌ で拒否、承認待ちの一覧のピン留め、DSH の再起動後の再接続。
- ボットの削除で、Synapse のユーザーが部屋を出て無効化され、記録が `retired`（`deactivated`）になり、ほかの記録が消える。
- 全体設定の画面で実装だけを Tuwunel に変えると `check` が断り、トークンを消してから Tuwunel に切り替えて保存できる（Tuwunel の注意が出る）。New bot ダイアログの「ボットと一緒に設定」から Tuwunel のボットを作り、DM での送受信と、質問カードへの返信（番号）での答えが通る。
- 確かめていないこと: 部屋のホーム（招待・候補・メンバーの検査・pin の権限の注意）、Tuwunel でのボットの削除、ファイルの送信（ボットから）、プラン確認とコネクターの操作のカード、ログイン情報の漏洩、オーナーが DM を出たときの作り直し、`limited` の穴埋め（単体テストだけ）、HTTPS の homeserver。
