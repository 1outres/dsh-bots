# ボットのログイン情報（パスワード管理サービス連携） 仕様

状態: 設計。bot-core の汎用部分（`feat/vault-core`）→ 1Password（`feat/vault-1password`）、ブラウザ（`feat/vault-browser`）、デスクトップ（`feat/vault-desktop`）、Discord の報告（`feat/vault-discord`）の順に入れる。

## 目的

ボットがサイトやアプリにログインできるようにする。ただし

- ボットが使えるのは、**オーナーがそのボットに選んだログイン情報（項目）と、その中で許したフィールドだけ**。
- パスワード・OTP・パスキーの秘密は **LLM に読ませずに** 入力する（ツールの引数・結果・プレビュー・台帳・通知・エラー・ログのどこにも値を入れない）。
- それでも何かの拍子にボットが読めてしまったら（ページの値を evaluate した、ファイルに残っていた…）、**必ずオーナーに報告する**。見つけた値はモデルに渡す前に伏せる。
- 平文の秘密を **ディスクにもメモリにも残さない**（Host では JS の文字列にせず `Uint8Array` で持ち、使い終わったら 0 で埋める）。
- 1Password を最初の実装とし、Bitwarden / Vaultwarden を後から **提供元（provider）の追加だけ** で足せる形にする。

## 0. 脅威モデル

| 守るもの                                                 | どう守るか                                                                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| モデル（とその提供者・セッションのログ）に秘密を渡さない | ツールは秘密を **ハンドル** で指す（`cred-…`）。値は Host → VM の入力経路だけを通る。結果は漏洩ガード（7 章）が検査して伏せる          |
| 選ばれていない項目・フィールドを使わせない               | 許可（grant）は bot × 項目 × フィールドの種類。Host が毎回検査。提供元の ID はボットに見せない                                         |
| 偽サイトに入力させない                                   | ブラウザでは入力先のフレームの origin を許可のサイトと照合（入力の直前にもう一度）。デスクトップは許可ごとに明示的に ON にしたときだけ |
| Host に平文を残さない                                    | 6 章。秘密はファイル・DSH の storage・ログ・例外のメッセージに入らない。メモリでは `SecretBytes` の中だけ、使い終わったら 0 埋め       |

守れないもの（UI と README に書く）:

- **VM はボットのもの**（ボットは VM の root）。入力した値はその時点でページの DOM・アプリのメモリにあり、ボットが意図すれば読める。読んだ結果がツールの結果としてモデルに戻る経路は 7 章で伏せて報告するが、画像（スクリーンショット）の中身は検査できない（「パスワードを表示」を押した画面など）。
- 提供元へ接続するための秘密（1Password のサービスアカウントトークン）は DSH の資格情報ストア（`ctx.credentials`）に置く。ストアの API が JSON（JS の文字列）で返すので、これだけは文字列として一時的にメモリに載る（OAuth のクライアントシークレットと同じ扱い）。
- OTP のコード（6〜8 桁、30 秒で失効）は誤検知が多すぎるので漏洩ガードの対象外（1Password からはシードを取り出さない）。ユーザ名は秘密ではないので対象外。
- 0 埋めは Host のコードが持つバッファまで。Node のストリームや SSH の内部バッファ、子プロセス（op、VM の補助）が持った写しは消せない（すぐ解放はされる）。
- origin やアプリ名は VM の中から報告される。ボットは VM の root なので、意図的な持ち出し（`curl -d @file` など）は防げない。この仕組みが防ぐのは事故と偽サイトへの入力で、悪意のあるボットではない。

## 1. 層

| 層                 | 内容                                                                                                   | 誰が持つか                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| 提供元（provider） | 1Password / Bitwarden… のアカウントへの接続、項目の一覧（値なし）、1 フィールドの取り出し              | provider パッケージ（`registerVaultProvider`）                       |
| 口座（account）    | オーナーがつないだ提供元のアカウント（1Password のサービスアカウント）。接続の秘密は `ctx.credentials` | bot-core                                                             |
| 許可（grant）      | bot × 項目。使えるフィールドの種類、サイト、デスクトップ可否、ボットに見せる名前                       | bot-core（オーナーが Web で決める）                                  |
| 取り出し（access） | 許可の検査 → provider から 1 フィールドを `SecretBytes` で取得 → 用途の検査 → 利用の記録 → 指紋の登録  | bot-core（`host/vaults/access.ts` だけが provider の取り出しを呼ぶ） |
| 入力               | 取り出した値を VM のページ・アプリに入れる                                                             | コネクター（ブラウザ・デスクトップ）                                 |
| 漏洩ガード         | ボットのすべてのツールの結果・引数・返答を検査、伏せる、報告                                           | bot-core（ボットのプリセットグループの行）                           |

## 2. コントラクト（`packages/dsh-bot-core/src/vault-contract.ts`、`shared/vaults.ts`）

```ts
/** 秘密の種類。provider は扱えるものを宣言する。 */
type VaultSecretKind = "password" | "otp" | "passkey"
/** フィールドの種類（ユーザ名は秘密ではない）。 */
type VaultFieldKind = "username" | VaultSecretKind

interface BotVaultProvider {
  readonly id: string // [a-z][a-z0-9-]*  "onepassword" / 将来 "bitwarden"
  readonly name: string
  readonly guide?: string // https のセットアップ手順
  readonly setup: readonly VaultSetupField[] // 口座をつなぐのに要る項目
  readonly kinds: readonly VaultSecretKind[] // 1Password は ["password", "otp"]
  /** 状態（1Password なら CLI の用意）。bot-core が設定画面に出す。 */
  readonly status?: { read(): VaultProviderStatus; subscribe(listener: () => void): () => void }
  open(setup: VaultSetup, signal: AbortSignal): Promise<VaultSession>
}

interface VaultSetupField {
  readonly key: string // [a-z][a-z0-9_]*
  readonly label: ConnectorText
  readonly kind: "secret" | "text" | "url"
  readonly required: boolean
  readonly help?: ConnectorText
}
/** secret の項目は SecretBytes で渡る。text / url は文字列。 */
interface VaultSetup {
  readonly text: Readonly<Record<string, string>>
  readonly secrets: Readonly<Record<string, SecretBytes>>
}

interface VaultSession {
  /** 口座の識別（1Password ならサービスアカウントのアカウント URL と名前）。 */
  identify(signal): Promise<{ readonly subject: string; readonly label: string }>
  /** 値を含まない一覧。 */
  listItems(signal): Promise<readonly VaultItemSummary[]>
  /** 1 項目の今のメタデータ（無ければ undefined）。値は含まない。 */
  item(ref: VaultItemRef, signal): Promise<VaultItemSummary | undefined>
  /** 1 つの秘密フィールドの値（password）か今の OTP（otp）。 */
  reveal(ref: VaultFieldRef, signal): Promise<SecretBytes>
  /** kinds に "passkey" を宣言した provider だけ。 */
  passkey?(ref: VaultFieldRef, signal): Promise<VaultPasskey>
  close(): Promise<void>
}

interface VaultItemRef {
  readonly vaultId: string
  readonly itemId: string
}
interface VaultFieldRef extends VaultItemRef {
  readonly fieldId: string
  readonly kind: VaultSecretKind
}

interface VaultItemSummary extends VaultItemRef {
  readonly vaultName: string
  readonly title: string
  readonly websites: readonly string[] // provider が持つ URL（正規化は bot-core）
  readonly username?: string // 秘密ではない（オーナーが見る。ボットに見せるかは許可で決める）
  readonly fields: readonly {
    readonly id: string
    readonly kind: VaultFieldKind
    readonly label: string
  }[]
  readonly updatedAt?: number
}

interface VaultPasskey {
  readonly rpId: string
  readonly credentialId: Uint8Array // 公開の値
  readonly userHandle?: Uint8Array
  readonly signCount: number
  readonly privateKey: SecretBytes // PKCS#8 DER
}
```

- `SecretBytes`（`vault-contract.ts`）: 1 回だけ使える秘密のバイト列。`use(fn: (bytes: Uint8Array) => Promise<T>)` が終わると（成功でも失敗でも）中身を 0 で埋め、二度目の `use` は throw。`wipe()`、`length`。`toString` / `toJSON` / `util.inspect` は `[secret]` を返す（誤ってログやエラーに入れても値が出ない）。`from(bytes)` は受け取った配列を自分のものにする（コピーしない。呼び手はその配列を以後使わない）。
- provider の約束（README と型の doc に書く）: 値を JS の文字列にしない、キャッシュしない、例外のメッセージに値を入れない、値の入った一時ファイルを作らない。

## 3. 保存（`dsh_bot_vaults` version 1、書き込みは `host/vaults/store.ts` だけ）

- `accounts`: `{ id: "vacct-<hex>", provider, label, subject, status: "active" | "error", statusReason?, createdAt }`。接続の秘密は `ctx.credentials` の `bot-core/vault-<id>`（payload `{ version: 1, secrets: { <key>: string } }`、既存の `secret-record.ts` の形）。
- `grants`: キー `<botId>:<grantId>`。`{ id: "cred-<hex>", botId, accountId, vaultId, itemId, label（ボットとオーナーが見る名前。既定は項目のタイトル）, kinds: VaultFieldKind[]（許したもの）, connectors: string[]（入力してよいコネクターの id。オーナーが 1 つ以上選ぶ）, sites: { origin, subdomains: boolean }[]（既定は項目の websites の https の origin）, desktop: boolean（既定 false）, showUsername: boolean（既定 true）, grantedAt }`。
- `uses`: 取り出しの記録（値なし）`{ id, botId, grantId, kind, connector, tool, sessionId?, target（origin かアプリ名）, at, outcome: "filled" | "refused", reason? }`。bot ごとに 500 件・90 日。
- `fingerprints`: 漏洩ガードの指紋（7 章）。キー `<botId>:<grantId>:<kind>`、1 レコードに変種ごとの指紋、作ったときのガードの鍵 ID（`keyId`）、許可の名前（`label`）、外したとき `revokedAt`（30 日後に消す）。
- `incidents`: 漏洩の記録（7 章）。
- 項目が provider から消えた・アクセスを失った許可は消さずに `missing` と表示する（オーナーが外す）。

## 4. ボットから見えるもの

- **ツール `credentials_list`**（bot-core が足す。許可が 1 つ以上ある bot の全セッション、Allow、引数なし）: 許可ごとに `handle`（`cred-…`）、`label`、`username`（`showUsername` のとき）、`sites`、使える種類（`password` / `otp` / `passkey`）、`desktop`。値も provider の ID も出さない。
- 入力のツールはコネクターが持つ（8・9 章）。引数は `credential`（handle）と `field`（種類）。プレビューは label と種類と入力先だけ。
- システムプロンプト（bot-core の prompt 行）に、許可があるボットにだけ 1 段落: 「ログインには `credentials_list` と各コネクターの credential ツールを使う。パスワードを人に聞かない・どこにも書かない・ページから読まない。値は見えないのが正常」。

## 5. コネクターへの口（`BotConnectorRun.vault`）

```ts
interface BotVaultAccess {
  /** その bot の許可。無い・missing なら throw（"not one of this bot's credentials"）。 */
  describe(handle: string): Promise<BotCredential>
  /** 秘密を 1 つ取り出す。用途を bot-core が検査し、記録し、指紋を登録してから渡す。 */
  reveal(
    handle: string,
    kind: "username" | "password" | "otp",
    target: CredentialTarget,
  ): Promise<SecretBytes>
  passkey(handle: string, target: BrowserCredentialTarget): Promise<VaultPasskey>
}
type CredentialTarget =
  | { readonly kind: "browser"; readonly origin: string } // 入力先フレームの origin
  | { readonly kind: "desktop"; readonly application: string } // フォーカスのあるアプリ（記録用）
```

- 検査（`host/vaults/access.ts`）: 許可がこの bot のもの、種類が `kinds` にある、provider がその種類を扱える、browser なら origin が `sites` のどれかに合う（scheme と host が一致。`subdomains` のときは `.<host>` で終わる host も。https 以外は許可に明示した origin だけ）、desktop なら `desktop: true`。passkey は加えて `rpId` が origin の host と同じかその登録可能な上位ドメイン。断ったら `refused` を記録して throw（理由に値は入らない）。
- ユーザ名も `SecretBytes` で渡す（入力経路を 1 本にする）。
- ツールの定義に `vault: true` を書いたツールだけが `run.vault` を受け取る（それ以外は undefined）。カタログの登録時に検査する。承認後の実行（Ask）でも使える。（名前は設計ルール 17 で bot-core 以外のパッケージが `credentials` を使えないため `vault` にした）

## 6. 平文を残さない（Host）

- provider → bot-core → コネクター → VM まで、値は `SecretBytes` / `Uint8Array` のまま。文字列化（`TextDecoder`、`toString`、テンプレート文字列、`JSON.stringify`）をしない。VM へ送る JSON の行が要るときは、固定部分と値（base64 をバイト列で作る）を `Uint8Array` で連結し、送ったら 0 埋めする（`host/vaults/bytes.ts` に base64・JSON 文字列エスケープ・連結のバイト列版を置く）。
- 値は **コマンドの引数（argv）・環境変数・ファイル** に入れない。VM へは `exec` の stdin か常駐プロセスの stdin で渡す。
- キャッシュしない（取り出しは入力 1 回ごと）。`uses` と台帳とログには値を書かない。
- 設計ルール（lint と test）: provider の `reveal` / `passkey` を呼べるのは `host/vaults/access.ts` だけ。`SecretBytes` の中身に触れるのは `use` の中だけで、`use` のコールバックでは文字列化の API を呼ばない（vaults と各コネクターの credential のファイルを対象に grit で禁止）。

## 7. 漏洩ガード

### 7.1 指紋

- 対象は password とパスキーの秘密鍵だけ（ユーザ名と OTP のコードは対象外）。取り出し（5 章）のたびと、許可を作ったとき（1 回取り出して）、値から指紋を作って `fingerprints` に保存し、値は 0 埋め。変わっていれば置き換える（パスワードの変更）。
- 変種: そのまま、JSON 文字列のエスケープ、URL エンコード（`%XX` と `+`）、HTML エスケープ、base64 / base64url（3 つの位相）。長さ 6 未満の値は対象外（理由を設定画面に出す）。
- 指紋 = `{ variant, length, probe, digest }`。`probe` は鍵つきの多項式ローリングハッシュ（バイトの表と奇数の乗数を鍵から HKDF で作る）を鍵つきの非線形な仕上げに通した上位ビット。候補の窓を絞るだけで、鍵が無ければ推測した値の probe は計算できない（鍵を持つのは Host の資格情報ストアで、そこが読めるなら 1Password のトークンも読める）。表が鍵全体から作られ仕上げが非線形なので、既知の平文と probe から鍵は求まらない。probe は 24 ビット（20 ビットでは 2 MiB の走査で scrypt の誤照合が数十回になり、数秒〜数十秒かかったため）。`digest` は scrypt（N=2^14, r=8, p=1、32 バイト）。鍵と salt はインストールごとの乱数で `ctx.credentials` の `bot-core/vault-guard`。鍵が作り直されると古い指紋は `stale` になり、その bot の結果はすべて伏せ（fail closed）、オーナーが「指紋を作り直す」まで続く。

### 7.2 検査する場所（行 `plugins/vault-guard.ts`、ボットのプリセットグループの中。DSH の scope でそのボットの Agent だけに届く）

- `tools/post-execute`: すべてのツール（bash・read・web_fetch・コネクター・サブエージェント…）の結果のテキストと JSON の文字列を、その bot の指紋の長さごとにローリングハッシュで走査し、probe が合った窓だけ scrypt で照合。見つかれば **その部分を `[withheld: secret of <label> (<kind>)]` に置き換えた結果をモデルに渡し**、事故を記録する（`redacted`）。
- **通る経路の一覧**（bot-core がモデルに渡す・モデルのために保存するもの。すべて `host/vaults/guard.ts` の `scan` / `shield` を通り、検査できなければ渡さない・保存しない）:
  - ツールの結果と引数（この行。bash・read・web_fetch・MCP・コネクター・サブエージェント・PTC）
  - assistant の返答と reasoning（Host の `session/event`。`exposed` を記録）
  - チャネルから人が送ったメッセージ（`conversation.ts`。伏せてからモデルへ、`inbound-message` / `redacted`）
  - notice の outbox（コネクターの action の終了・スケジュール・イベント・ファイル・管理セッション。保存の前に、`bot-context`）
  - 承認後に実行した action の結果と失敗の理由、Ask の snapshot（台帳に保存する前に）
  - コネクターのイベント（受け取る bot ごとに、保存の前に）
  - ピン留めのノートと「ノートの言及」の notice（ステップの準備で伏せてから context へ）、スキルの一覧と本文
- **範囲外**: 画像（スクリーンショット）、UI にだけ出る進捗（bash のストリーム出力など）、dsh-tools が post-execute を通さずに返す失敗、値を分割して出力したもの（`'abc' + 'def'` の各部分は値ではない）、走査の上限を超えた部分（読まずに伏せる）。
- **走査**: 文字列・数値・キーを見る（`type: "image"` のブロックは見ない）。各テキストは、そのままのほか、JSON の `\\uXXXX` などを戻した読み、`%xx`（大小）と `+` を戻した読み、HTML の文字参照（`&#x27;` など）を戻した読み、空白を除いた読み（折り返した base64 / hex）も走査し、読みの中で見つかったらそのテキスト全体を伏せる。1 回の走査は 2 MiB まで読み、超えた分は読まずに伏せる（`[withheld: too long for the vault guard to check]`。fail open にはしない）。同じ窓の digest は走査の中で使い回す。
- `tools/pre-execute`: 引数に値があれば（モデルが既に知っている）実行を断り、事故を記録する（`exposed`）。
- セッションの assistant の返答（`session/event`）: 値があれば事故を記録する（`exposed`。取り消せない）。
- 記録の保存に失敗したら、その結果はモデルに渡さずツールのエラーにする（fail closed）。

### 7.3 報告

- `incidents`: `{ id, botId, sessionId, at, source: "tool-result" | "tool-arguments" | "assistant-message", tool?, grantId, kind, outcome: "redacted" | "exposed", acknowledgedAt? }`。
- **オーナーに必ず届ける**: Web（ボットのシェルの上部に未確認の事故の帯、Bots 一覧のバッジ、設定の「ログイン情報」に履歴と「確認した」）と、owners を宣言したチャネル（新しい出力 `credential-incident`。Discord は owners の DM）。outcome が `exposed` のときはパスワードの変更を勧める文を必ず添える。確認されるまで帯は消えない。
- ボットへ: 伏せた結果の置き換え文がそのまま知らせになる（「値を読まない手順に変えて続ける」）。

## 8. ブラウザ（`@1outres/dsh-bot-connector-browser`）

- `browser_fill_credential { credential, field: "username" | "password" | "otp", ref, submit?: boolean }`（Allow、exclusive `page`、`vault: true`）:
  1. `run.vault.describe` で許可を確かめ、`field` が `kinds` に無ければ断る。
  2. Playwright MCP の `browser_evaluate`（`target: ref`）で要素に一度きりの印（`data-dsh-fill=<32 桁の乱数>`）を付けるだけ。結果は使わない（ページの JS が返す値は信用しない）。
  3. VM の補助 `dsh-browser-fill`（`vm/helper/`、Node、依存なし。準備で `/opt/dsh-browser/helper` に root で置く。ベースイメージも同じ `vm/install-helper.sh` で入れる）を `spawn` し、stdin に `{ devtools, mark, field }` を渡す。補助は CDP（127.0.0.1:9222）の page / iframe（別プロセスのフレームも）すべてに付き、各フレームの isolated world で印を探す（open な shadow root も）。ちょうど 1 つでなければ断る。**origin はブラウザが報告するフレームの `securityOrigin`**（ページの JS の `origin` は偽れるので使わない）。要素は enabled な input（text 系の type）・textarea・contenteditable だけ、password は `type=password` か autocomplete `current-password` / `new-password` だけ。`{ located: { origin, element } }` を返す。
  4. Host が `run.vault.reveal(handle, field, { kind: "browser", origin })`。断られたら補助の stdin を閉じる（補助は印を外して終わる。値は送らない）。
  5. `{ fill: { origin, submit, length } }` の行と値の生バイトを 1 つの配列で stdin に書き、すぐ 0 埋め。補助は origin が 3 の値と同じか確かめ、フレームの origin を取り直して照合 → `DOM.focus` → 既存の値を選択 → もう一度 origin を照合 → `Input.insertText`（CDP のメッセージは補助が自前の WebSocket でバイト列から組み立て、値を JS の文字列にしない）→ 印を外す → `submit` なら Enter。
  6. 結果は「Filled the <field> of "<label>" in <origin>」だけ。値もスナップショットも返さない。補助は閉じたコード（`not-found`、`origin-changed` など）しか出力せず、Host は固定の文に直す。
- `browser_use_passkey { credential }`（Allow、exclusive `page`、`vault: true`）: `passkey` の無い許可（1Password）は「"<label>" has no passkey this bot may use … browser_fill_credential を使う」でページにも vault にも触れずに失敗。Playwright MCP で今のタブの `documentElement` に印（`data-dsh-passkey`）を付け、補助 `dsh-browser-passkey` がその page の主フレームの `securityOrigin` を返す → `run.vault.passkey(handle, { kind: "browser", origin })` → 秘密鍵（PKCS#8）を stdin のバイトで渡す → 補助がそのタブのセッションで `WebAuthn.enable` → `addVirtualAuthenticator`（ctap2、internal、resident、UV あり、自動で presence）→ `addCredential` → `ready`。ツールはここで返り「60 秒以内にサイトのパスキーでのサインインを押す」と案内する。補助は **60 秒、`credentialAsserted` 1 回、主フレームが別 origin へ移る、タブが閉じる、Host が終わらせる** のどれかで認証器を外して終わる。補助のプロセスはコネクターの常駐リソース（attachment）が持ち（ツールの呼び出しの signal は呼び出しが終わると切れるため）、次の `browser_use_passkey` と常駐リソースの破棄で終わらせる。
- 準備: Chrome のパスワード保存と自動入力を切る（デスクトップの Chrome の managed policy `PasswordManagerEnabled=false`、`PasswordLeakDetectionEnabled=false`、`AutofillAddressEnabled=false`、`AutofillCreditCardEnabled=false`。`packages/dsh-bot-connector-desktop/vm/config/chrome-policy.json` を準備が `/etc/opt/chrome/policies/managed/dsh-desktop.json` に置き、ベースイメージにも入れる。Chrome は書き換えを再起動なしで反映する。Chrome 158 では Autofill の 2 つは Deprecated と表示されるが有効）。

## 9. デスクトップ（`@1outres/dsh-bot-connector-desktop`）

- `desktop_type_credential { credential, field: "username" | "password" | "otp", element?: string, submit?: boolean }`（Allow、exclusive `display`、`vault: true`）: 許可の `desktop` が true のときだけ（bot-core が検査）。フォーカスが Chrome（ブラウザ）なら断る（origin の照合を迂回させない。ブラウザは `browser_fill_credential` を使う）。agent のメソッドは 2 段: `secret_target { field, element? }` がフォーカス（または element にフォーカスを移して）の AT-SPI の役割を確かめ（password は `password text`、他は編集できるテキスト）、アプリ名と一度きりのトークンを返す → `reveal(… { kind: "desktop", application })` → `type_secret { token, submit }` に値を要求の `secret` メンバー（base64 をバイト列で組み立てた JSON-RPC の行）で渡し、送ったら 0 埋め。agent は同じ欄がまだフォーカスを持つことを確かめ直し、`xdotool type --file -` に stdin で渡す（argv に入れない、**クリップボードは使わない**）。キーで打てない文字（印字可能な ASCII 以外）があれば何も打たずに失敗する。agent はこのメソッドの引数を記録・エラー・応答に入れない。詳細は末尾「実装で確定したこと（`feat/vault-desktop`）」。

## 10. 1Password（`@1outres/dsh-bot-vault-1password`、row `bot-vault-1password`）

- 認証は **サービスアカウント**（オーナーがボット用の Vault だけに読み取りで作る。ガイドに手順）。setup は `token`（secret）だけ。
- **op CLI は dsh-bots が管理する**: パッケージにピン留めした版と、プラットフォームごとの公式 zip（`https://cache.agilebits.com/dist/1P/op2/pkg/v<ver>/op_<os>_<arch>_v<ver>.zip`）と中の `op` の SHA-256 を持ち、初回に DSH のホームの下（`<DSH_HOME>/bot-vault-1password/op/<ver>/op`、0700）へ取得・検証・展開する。検証できなければ使わない（PATH の op は使わない。fallback なし）。状態（取得中・ready・失敗）を provider の `status` で出す。
- 実行: `spawn`（シェルなし）、環境変数は `OP_SERVICE_ACCOUNT_TOKEN`・専用の `HOME` / `OP_CONFIG_DIR`（0700 の一時ディレクトリ）・`OP_FORMAT=json`・`OP_CACHE=false` だけ（親の環境を継承しない）、タイムアウトあり、stdout は Buffer で受ける。
  - `identify`: `op whoami`。`listItems`: `op vault list` と `op item list --vault <id> --categories Login,Password`（値を含まない）。
  - フィールドの種類（`item`）: `op item get <id> --vault <vid> --format json` は値も返すので、**出力の Buffer をバイトのまま走査する JSON パーサ**で `value` / `totp` / `reference` を文字列にせずに読み飛ばし、id・type・purpose・label・ユーザ名・URL だけを取り出し、Buffer を 0 埋めする。
  - `reveal`: `op read --no-newline op://<vaultId>/<itemId>/<fieldId>`（OTP は `?attribute=otp`）。ID は英数字と `_` だけを受け付ける（参照の注入を防ぐ。OTP のフィールドは `TOTP_<id>`）。stdout の Buffer をそのまま `SecretBytes` にする。
- provider id は `onepassword`。`kinds: ["password", "otp"]`。パスキーは 1Password の SDK / CLI / Connect のどれも秘密鍵を出さないので扱えない（設定画面のトークン欄の説明にそう出す）。詳細は末尾「実装で確定したこと（`feat/vault-1password`）」。

## 11. Web の画面（bot-core）

- 全体設定に「パスワード管理」: provider ごとに口座の追加（setup の form。secret は入力後に読めない）、状態、識別、名前の変更、削除（その口座の許可も消えると確認）。
- ボットの設定に「ログイン情報」: 許可の一覧（label、口座と Vault、サイト、種類、デスクトップ、最後に使った時刻、missing）、追加（口座 → 項目を検索。タイトル・ユーザ名・サイトだけ見える → 種類・サイト・デスクトップ・名前を決めて保存）、編集、外す、利用の履歴、事故の履歴と確認。
- Remote `botVaults`（owner のみ。11.1 の decide と同じ principal の検査）: `watch()`、`addAccount`、`renameAccount`、`removeAccount`、`listItems(accountId, query)`、`watchBot(botId)`、`grant`、`updateGrant`、`revoke`、`acknowledgeIncident`。どれも値を返さない。

## 12. Bitwarden / Vaultwarden を足すとき

provider を 1 つ登録するだけ: setup（サーバー URL、client_id / client_secret、マスターパスワード）、`kinds: ["password", "otp", "passkey"]`（`fido2Credentials` の鍵を `passkey` で返す）。bot-core・ブラウザ・デスクトップは変わらない。

## 13. 先に確かめること（spike）

- グループの行の `tools/post-execute` が結果を置き換えられ、コネクター・サブエージェント・MCP のツールの結果も通ること。
- サービスアカウントで `op read op://<vaultId>/<itemId>/<fieldId>`（ID 指定）と `?attribute=otp` が動くこと。zip の URL とハッシュ。
- CDP の補助が Playwright MCP と同じ Chrome に同時につなげること。WebAuthn の仮想認証器はそれを作った CDP セッションが付いている間だけ有効なこと（確かめた。末尾「feat/vault-browser」）。

## 14. 検証用

- `dev/fake-vault`: provider `fake-vault`（`development`）。JSON の項目（パスワード、TOTP のシード、パスキーは起動時に生成）。テストと動作確認用の DSH でだけ入れる。
- `dev/fake-vault` にログイン・TOTP・パスキー（WebAuthn）のテストページを VM の中で配る小さなサーバーも置く（localhost は secure context なのでパスキーを試せる）。

## 実装で確定したこと（`feat/vault-core`）

- **spike（13 章の 1 項目目）は成り立つ**: ボットのプリセットグループ内の行（`plugins/vault-guard.ts`、行 id `env-bot-core-vault-guard`。`credentials_list` は別の行 `plugins/vaults.ts`・`env-bot-core-vaults`）で `ctx.on("tools/pre-execute" | "tools/post-execute", …, { prepend: true })` を聞くと、dsh-tools の scope でそのボットの Agent（Main、scope parent をたどれる subagent・子 Agent）の呼び出しだけが届く。グローバルなツール（bash など）、グループ内で scoped に登録したコネクターのツール、ツールの中からのネスト実行（PTC の run_code と同じ形）、サブエージェントの結果がすべて通り、別のプリセット・scope の無い Agent には届かない。実 ToolsService と ToolExecutionPipeline で確かめるテストは `packages/dsh-bot-core/test/vault-guard-scope.test.ts`。動作確認用 DSH で、実モデルが bash の `printf` で出したパスワードが `[withheld: secret of Example login (password)]` に置き換わってモデルに渡ることも確かめた。
- **post-execute の置き換え方**: `accept { content }` は `value`（PTC のプログラムが読む）と `meta` を残すので使わない。秘密が見つかったら、value に秘密があった成功は `accept { value: 伏せた value }`（ツールの output schema で検査され、render し直される）、content にだけあった成功（render が組み立てた値など）・失敗・ほかの行の `block`・`additionalContexts` に秘密がある場合は `block`（`feedback` は伏せた content、`info` は `VaultGuard` / `SECRET_WITHHELD`）。事故を保存できない・ガードが検査できない・Agent がそのボットのものと確かめられないときは `block`（`VAULT_GUARD_FAILED`、fail closed）。dsh-tools が post-execute を通さずに返す失敗（引数の JSON 化の失敗、tools/execute の throw）は対象外。post-execute の後に走るツールの `finalizeContent`（DSH の terminal・jobs）は渡された content の切り詰めだけで、値を戻さない。
- **pre-execute**: 引数に値があれば `deny`（`SECRET_IN_ARGUMENTS`）して `exposed` を記録する。記録に失敗しても deny は変えない。
- **assistant の返答**: Host の `session/event` の `assistant/message` を聞き（`session/event` は scope で絞られないため index.ts で bot を引く）、テキストに値があれば `exposed` を記録する。
- **名前**: コネクターの口は `BotConnectorToolBase.vault?: true` と `BotConnectorRun.vault?: BotVaultAccess`（設計ルール 17）。対象の型は `BrowserCredentialTarget` / `DesktopCredentialTarget`。
- **型を import するだけのパッケージのために**: provider とコネクターは bot-core の値を import できない（型だけ）ので、`Bot.vaultKit()` が `secret(bytes)`（`SecretBytes` を作る）と `base64` / `base64Url` / `jsonString` / `concat` / `wipe` を渡す。バイト列の関数は `src/vault-bytes.ts`（6 章の `host/vaults/bytes.ts` の代わり。パッケージの入口からも出す）。
- **SecretBytes** は `length` と `spent` を持つ。bot-core が値を指紋にするときは `use` の中で一度だけ読み、渡す分は `bytes.slice()` を新しい `SecretBytes` にする（元は 0 埋め）。
- **setup の秘密**: `VaultSetup.secrets` の `SecretBytes` は provider のもの（セッションを閉じるとき、または `open` の失敗時に provider が 0 埋めする）。1Password のトークンのように毎回要るものは provider が持ち続ける。text / url の値も同じ `bot-core/vault-<accountId>` のレコードに入れる（setup の値をまとめて 1 つにするため）。
- **保存**: `dsh_bot_vaults` version 1。レビューで足した項目は既定値つき（`connectors` が無い許可はどのコネクターも使えない、`keyId` が無い指紋は stale で fail closed）なので、それ以前の記録もそのまま読める。`fingerprints` は 3 章のとおり 1 レコードに変種ごとの指紋と `state`（`fingerprinted` / `short`）。`incidents` は事故の時点の `label` を持つ。未確認の事故に同じ許可・種類・経路・結果のものが来たら新しく作らず `repeats` と `lastAt` を増やす（未確認は消さないので、数はこれで抑える）。確認済みは bot ごと 500 件・90 日。`uses` は bot ごと 500 件・90 日。許可を外した指紋は 30 日残して探し続ける。
- **変種**: そのまま、JSON 文字列のエスケープ、`encodeURIComponent`（`%XX`）、フォームの URL エンコード（`+`）、HTML エスケープ、hex（小文字・大文字）、base64 と base64url のそれぞれ 3 つの位相。6 バイト未満の変種は持たない。ほかの書き方は 7.2 の「読み」で拾う。
- **missing**: 項目を読めたかどうかはメモリだけ（`host/vaults/availability.ts`）。設定画面の `watchBot` の開始・`credentials_list`・取り出しのたびに読み直す。`credentials_list` は読めない許可に理由を付けて出す。
- **システムプロンプトの段落**: 許可は途中で増減するので、section ではなく context `bot:logins`（許可のある bot だけ）にした。`credentials_list` も `when` で許可のある bot にだけ見せる。
- **Remote `botVaults`**: `watch` / `watchBot` も含めて全メソッドで principal が `owner` か確かめる。`watch` の snapshot に bot ごとの未確認の事故の数（`openIncidents`）を入れ、Bots 一覧のバッジとシェルの帯はこれを読む。帯は Banner に「確認する」ボタン（設定の「ログイン情報」を開く）を足したもので、閉じるボタンは無い（確認するまで消えない）。
- **チャネル**: 出力 `credential-incident`（`VaultIncidentView`）と capability `credentialIncidents?: true`（owners の宣言が要る。`connectorActions` と同じ検査）。記録したときに送り、オーナーが確認するまでは新しい接続のたびにも送る（チャネルは id で 1 回だけ見せる）。
- **Discord（`feat/vault-discord`）**: `credentialIncidents: true` を宣言し、オーナー（設定の「オーナー」、キー `approvers`）各人の DM にカードを送る（会話できるユーザーには送らない）。カードは通知の言語（en/ja）で、見出し（ボット名。redacted は 🔒、exposed は 🚨）、ログイン情報の label と種類、どこで（ツール名つきの結果／引数、ボットの返答、ボットに送られたメッセージ `inbound-message`、ボットに渡す情報 `bot-context`）、いつ（Discord のタイムスタンプ。`repeats` があれば合計の回数と `lastAt`。カードを送った時点の値で、後で増えてもカードは変えない）、outcome（redacted＝伏せてモデルには渡っていない／exposed＝モデルが読んだ）、exposed なら今すぐ変えるもの（password はパスワード、passkey・otp はそれとパスワード）、最後に Web UI のボットの設定「ログイン情報」で確認するよう案内。カードに出すのはこれらのフィールドだけ（sessionId・grantId などは出さない）。bot-core にチャネルからの確認の入口が無いので確認ボタンは置かず、確認されてもカードは変えない（bot-core はそのとき何も送らない）。「1 回だけ」は事故 × オーナーごと: 送れたら `dsh_bot_discord` の表 `incidents`（キー `<botId>:<incidentId>:<userId>`、version 2 で追加、version 1 を読める）に記録し、記録のあるオーナーには送らない。DM に送れなかったオーナーには次の接続で送り直し、新しく加わったオーナーには未確認のものが届く。送るべきオーナーの誰にも届かなかったときだけ出力を失敗にする（bot-core が警告を記録）。オーナーが空なら何もしない。記録はボットの削除まで残す（未確認の事故は古くても接続のたびに来るため）。表の書き込みは設計ルール 72（`host/actions/records.ts`・`host/incidents/records.ts` だけ）。
- **Web**: 全体設定「パスワード管理」（provider ごとの状態・扱える種類・口座の追加（名前と setup の form。secret は password 入力）・名前の変更・削除の確認）、ボット設定「ログイン情報」（一覧、項目の検索から追加、詳細で名前・ユーザ名を見せるか・デスクトップ・種類・サイト（1 行 1 origin、`https://*.host` でサブドメインも）・削除、事故の履歴と「確認した」、利用履歴）。サイトの既定は項目の https の origin だけなので、http の localhost などはオーナーが書く。
- **rpId の検査**は「origin の host と同じか、ドット付きの上位ドメイン」。公開接尾辞リストは持たない（許可の sites の検査とブラウザ自身の WebAuthn の検査が先にある）。
- **設計ルール** 58（vaults の表は `host/vaults/store.ts` だけ）、59（provider の `reveal` / `passkey` は `host/vaults/access.ts` だけ）、60（`tools/pre-execute` / `tools/post-execute` は `plugins/vault-guard.ts` だけ）、61（`SecretBytes.use` のコールバックで文字列化しない。`host/vaults/`、`vault-*.ts`、コネクターと `dsh-bot-vault-*` のパッケージ）。34 の例外に `plugins/vaults.ts`。
- **dev/fake-vault**: provider は `Bot.vaultKit().secret` で値を渡す。passkey は口座のセッションを開くたびに作り、`FAKE_VAULT_PASSKEYS` のファイルに公開鍵側を書く。テストページは `node dev/fake-vault/cli.js`（`/login`、`/otp`、`/passkey`、`/account`）。
- **セキュリティレビューで直したこと**:
  - `SecretBytes.from` は受け取った配列を自分の配列へ移し、元を 0 埋めする（Node の Buffer はプールの view のことがあり、`slice` は view を返すため）。bot-core の中のコピーは `new Uint8Array(bytes)`。設計ルール 61 で `use` のコールバックの `slice` / `subarray` / `Buffer.from` / `Array.from` / `join` と、関数参照を渡すことも禁止した。
  - 承認後の action の結果・Ask の snapshot・notice・イベント・ノート・スキル・チャネルからの受信も検査する（7.2 の一覧）。
  - 鍵の導出を HKDF に、probe に鍵つきの非線形な仕上げを入れた（7.1）。指紋に鍵 ID を持たせ、合わなければ fail closed。
  - `vault: true` のツールは `snapshot` を持てない（カタログで断る）。run は目的（`execute` / `snapshot`）を持ち、snapshot には `vault` を渡さない。
  - 走査の上限（2 MiB）、image ブロックを見ない、窓の digest の使い回し、数値と読み（7.2）。
  - 許可を外しても指紋を 30 日残す。
  - provider の例外の文はボットに渡さない（ボットには bot-core の定型文、オーナーの利用履歴に provider の文、Host のログには例外の名前だけ）。
  - run が終わると、その run が渡した `SecretBytes` を bot-core がまとめて 0 埋めする（`PreparedRun.release`）。取り出しの後に呼び出しが取り消されていれば渡さない。provider の `open` が失敗したら setup の秘密を bot-core が 0 埋めする。
  - 許可ごとに入力してよいコネクター（`connectors`、1 つ以上。オーナーが UI で選ぶ。既定の選択は無い）。`run.vault` は run のコネクターの id を照合する。
  - ログイン情報の無いボットではガードは何もしない（Agent の照合より先に見る）。
  - handle は `cred-<hex>` の形と bot の一致を確かめる。未確認の事故は同じものを `repeats` にまとめる。assistant の reasoning も検査する。口座の削除と接続中のセッションの競合で、削除後に開いたセッションは閉じて捨てる。
  - チャネルへの `credential-incident` は、記録したときと、オーナーが確認するまで新しい接続のたびに送る。
- **残っていること**: ツールの実行中の進捗表示（bash のストリーム出力など、モデルには渡らないが UI に出るもの）は検査していない。チャネルへの返信（Discord に送る assistant の返答）は記録するだけで送信前に伏せない。画像は検査できない。

## 実装で確定したこと（`feat/vault-browser`）

- **spike（13 章の 3 項目目）は成り立つ**: VM の Chrome に Playwright MCP がつないだまま、別の CDP クライアントが同じ page に付いて Runtime / WebAuthn を使え、Playwright MCP のスナップショットも続けて動く。仮想認証器はそれを作ったセッションが付いている間だけ有効で、`Target.detachFromTarget` でも WebSocket を切るだけでも消える（その後の `navigator.credentials.get` は認証器が無く失敗し、別のセッションからは古い authenticatorId が見えない）。`WebAuthn.credentialAsserted` は使われたときに届く。
- 補助は 1 本（`dsh-browser-fill`）ではなく、`vm/helper/` の ES モジュール群（`cdp.mjs` 自前の最小 WebSocket と CDP、`page.mjs` 印とフレーム、`channel.mjs` stdin、`bytes.mjs`、入口の `dsh-browser-fill.mjs` と `dsh-browser-passkey.mjs`）。DevTools の場所は Host が要求の行で渡す（`127.0.0.1:<port>` だけ受け付ける。テストは偽の DevTools に向ける）。
- 入力の補助も `exec` ではなく `spawn`（位置の確認 → reveal → 値、を 1 つの CDP 接続と要素の handle のまま行うため）。値は spawn の後に stdin で渡す（argv・環境変数には入らない）。
- origin は Playwright MCP の evaluate の結果ではなく補助がブラウザから取る（ページの JS は `window.origin` を上書きできる）。reveal に渡すのもこの origin。
- Enter は印を外した後に押す（送信で移ったページでは印を外せないため）。
- 常駐リソースの値は `{ mcp, passkeys }`（Playwright MCP と、パスキーの補助を 1 つ持つ枠）。
- 設計ルール: 64（コネクターの `SecretBytes.use` の中で `exec` / `spawn` / `writeFile` / `console` / `process.env` を使わない）、65（ブラウザ コネクターで vault の `reveal` / `passkey` を呼ぶのは `src/host/vault/tools.ts` だけ）、66（補助のテスト: 期待した origin の印の要素だけに打ち、値を出力しない）、67（Chrome の policy のテスト）。
- デスクトップ パッケージで触ったのは `vm/config/chrome-policy.json`、`src/host/vm/files.ts` の配置 1 行、`src/host/vm/layout.ts` の `CHROME_POLICY`、`test/base-image.test.ts`。policy の変更で Chrome は再起動しない（Chrome は managed policy のディレクトリを見ていて、書き換えると 20 秒以内に再起動なしで反映することを確かめた）。

## 実装で確定したこと（`feat/vault-desktop`）

- ツールは `desktop_type_credential`（`vault: true`、Allow、exclusive `display`、人が操作している間は `USER_IN_CONTROL` で断る）。結果は「<label> の <field> を <アプリ> (<役割> "<名前>") に入力した」と、入力後のアクティブウィンドウとフォーカス（役割と名前）だけ。
- agent のメソッドは 2 つに分けた: `secret_target { field, element? }`（element があればそれにフォーカスを移してから。編集できるテキスト＝`EditableText` と `editable`、password は `password text` だけ、アクティブウィンドウのアプリであること、ブラウザでないことを確かめ、アプリ名と一度きりのトークン（120 秒）を返す）と `type_secret { token, submit }`（値を受け取って打つ）。ブラウザの判定は AT-SPI のアプリ名と `/proc/<pid>/exe` の名前（Chrome / Chromium / Firefox など）。ツールは `describe` → `secret_target` → `reveal(… { kind: "desktop", application })` → `type_secret` の順で、bot-core が断ったら何も打たない。
- 値は JSON-RPC の要求の `params` ではなく要求自身の `secret` メンバー（base64）に入れる。行は `bot.vaultKit()` で `<要求の JSON の最後の } を除いたもの>,"secret":"<base64>"}\n` をバイト列で組み立て、書いたら行と base64 を 0 埋めする（`src/host/agent/rpc.ts` の `callSecret`。送れなかったときも `SecretBytes` を 0 埋め）。agent は `secret` を `type_secret` 以外では受け付けない。
- agent は打つ前に、同じ要素がまだフォーカスを持ち、そのアプリのウィンドウがアクティブで、条件（役割・ブラウザでない）を満たすことを確かめ直す。**打てるのは印字可能な ASCII（0x20〜0x7E）だけ**（「キーで打てない文字」の定義。満たさなければ何も打たずに `untypeable`）: キーマップに無い文字は xdotool が空きキーを都度割り当て直して打つが、動作確認の VM（US 配列、fcitx5 あり）で Ü が ü になる・連続する非 ASCII（パス）の 1 文字が落ちる、が黙って起きたため。制御文字（改行で送信してしまうなど）も断る。欄の文字を `deleteText` で消してから `xdotool type --clearmodifiers --file -` の stdin に渡し、打った後にフォーカスを確かめ（移っていたら「値の一部が別の場所に入ったかもしれない」として失敗）、欄の文字数が値の長さと同じかを確かめる（違えば欄を空にして `typed_incompletely`）。`submit` は Return。
- GTK4 のアプリ（Debian 13 の zenity など）のパスワード欄は AT-SPI の役割が `text` で `password text` にならないため、password は断られる（ユーザ名・OTP は入る）。GTK3（yad など）と LibreOffice の gtk3 VCL は `password text`。
- `uses` の `filled` は bot-core が値を渡した時点で記録されるので、その後に agent が断った（`untypeable`、フォーカスの移動など）場合も `filled` のまま残る（bot-core の 5 章の記録の意味）。
- agent の `type_secret` の失敗は agent 自身の定型のメッセージだけを返し、ほかの例外は `type_secret failed` にしてトレースバックも出さない（例外の文字列に値が入りうるため）。xdotool の stderr も捨てる。
- 設計ルール 62（デスクトップのパッケージで `.reveal()` / `.passkey()` を呼べるのは `host/tools/credentials.ts` だけ、grit）と 63（agent の `type_secret` が値を応答・エラー・ログ・引数・クリップボードに出さない、`test/agent/test_secret_input.py` を vitest から `python3` で実行）。
- 0 埋めは Host まで。agent（Python）の中では値は `bytes`（不変）で、0 埋めできない（0 章のとおり VM はボットのもの）。
- 動作確認（DSH_HOME=/tmp/dsh-vault-desktop）: 実モデルが yad（GTK3）のログインダイアログにユーザ名とパスワード（`"`・`\` を含む ASCII）を入力し、ダイアログの出力の sha256 が値と一致した。Chrome のアドレスバーでは `browser_refused`、デスクトップを許可していないログインは bot-core が断った。値と base64 は DSH_HOME（セッション・ストレージ・ログ）、VM の journal、クリップボードのどこにも出なかった。

## 実装で確定したこと（`feat/vault-1password`）

- **パッケージ**: `@1outres/dsh-bot-vault-1password`（行 `bot-vault-1password`、`@1outres/dsh-bots` に追加）。Host だけ（client なし）。provider id は `onepassword`（2 章の例の `1password` は id の形 `[a-z][a-z0-9-]*` に合わないため）。bot-core は peer で型だけ、`ctx.get("bot")`（設計ルール 8 の例外に追加）。設定の手順は `docs/1password.md`（provider の `guide`）。bot-core の変更は 1 か所だけ: 全体設定「パスワード管理」の口座の追加の form で、setup の各項目の `help` を項目名の下に出す（`client/vaults/VaultsSettings.tsx` の `Row` に `meta` を渡す。これまで `help` は表示されていなかった）。
- **op CLI**: 版（2.42.0）とプラットフォームごと（linux / darwin × amd64 / arm64）に **zip の SHA-256 と中の `op` の SHA-256** の両方を `src/cli/release.ts` に固定（どちらも GPG 署名を確かめた zip から取った）。置き場所は `<DSH のホーム>/bot-vault-1password/op/<ver>/op`（`~/.dsh` か `$DSH_HOME`、途中のディレクトリはすべて 0700、シンボリックリンクは拒否）。起動時に既存の `op` を SHA-256 で確かめ、合わなければ取得 → zip の SHA-256 → 名前がちょうど `op` の項目だけを取り出し（項目名は比較するだけでパスに使わない。stored / deflate、サイズ上限、暗号化・重複は拒否）→ `op` の SHA-256 → 一時ファイル（`wx`、0700）から rename。ほかの版のディレクトリは消す。失敗したら status が `failed`（理由つき）で、次の接続時にやり直す（PATH の op は使わない）。status の `preparing` の step は Checking / Downloading / Installing。版の上げ方は infra/RELEASING.md「1Password CLI」。
- **実行**: 環境変数は `OP_SERVICE_ACCOUNT_TOKEN`・`HOME`・`OP_CONFIG_DIR`・`OP_FORMAT=json`・`OP_CACHE=false` だけ（親の env を継承しない）。`HOME` は口座のセッションごとに OS の一時ディレクトリに作る 0700 のディレクトリ（`OP_CONFIG_DIR` はその下の 0700）で、セッションを閉じると消す。コマンドごとにタイムアウトと出力の上限、口座あたり同時 4 つまで。stdout は読んだチャンクを連結したら 0 埋めし、失敗時も 0 埋めする。
- **トークン**: setup の `SecretBytes` から 1 回だけコピーしてセッションが持ち（閉じると 0 埋め）、形（`ops_` で始まる・使える文字・長さ）を値を引用せずに検査する。op が受け取れるのは環境変数だけなので、コマンドごとに JS の文字列になる（0 章の接続の秘密の例外）。
- **エラー**: op の stderr は理由の分類（トークンを受け付けない・権限なし・見つからない・レート制限・届かない・タイムアウト・中断・出力過大・その他）にだけ使い、メッセージに引用しない（op は不正なトークンの一部をエラーに出すことがある）。stdout も ID もメッセージに入れない。`item` は見つからない・権限なし（403）なら `undefined`。
- **identify**: `op whoami` の `user_type` が `SERVICE_ACCOUNT` のときだけ。subject は `<url>#<user_uuid>`、label は `1Password <ホスト>`。
- **項目**: カテゴリが Login / Password のものだけ。フィールドは purpose が USERNAME の最初のもの（その値がユーザ名）、purpose が PASSWORD の最初のもの（ほかの CONCEALED は出さない）、type が OTP の最初のもの。websites は `urls[].href`、updatedAt は `updated_at`。
- **ID**: 英数字と `_`、64 文字まで（OTP のフィールドの id が `TOTP_<id>` のため、10 章の「英数字だけ」から `_` を足した）。それ以外の ID は op を呼ぶ前に断り、そういうフィールドは項目に出さない。
- **JSON の読み方**: `src/json/reader.ts` がバイト列を文字列にせずにスパンの木にし、`text()` で求められた文字列ノードだけをデコードする。`isText()` はバイトで比較する。読み終えたら Buffer を 0 埋め。テストは `TextDecoder.decode` / `Buffer.toString` / `String.fromCharCode` をすべて記録して、値（パスワード・履歴・OTP のシードと現在のコード・ほかの CONCEALED・メモ）が一度もデコードされないことを確かめる。
- **レート制限への対策**: `listItems` は `op vault list` と Vault ごとの `op item list` のあと、項目のメタデータ（値なし）を `updated_at` ごとに覚えておき、新しいか変わった項目だけ `op item get` する。一覧は 30 秒間、オーナーの検索（入力が止まるたびに呼ばれる）に使い回す。入力 1 回は読み取り 2 回（bot-core の `item` と `reveal`）。初回の一覧は項目ごとに 1 回読むので、項目の多い Vault では時間がかかり（bot-core の一覧の期限は 60 秒）上限にも近づく。ボット用の小さな Vault を前提にする。429 は「レート制限」のエラーになる。
- **パスキー**: `kinds` は `["password", "otp"]`。設定画面にはトークン欄の説明（`help`）の先頭で「パスキーは使えない」と出す（bot-core に provider の説明文の欄が無いため。説明は 1 行に切り詰めて出るので先頭に置く）。書き込みのコマンドは使わない。
- **設計ルール** 68（プロセスの起動は `src/op/runner.ts` だけ）、69（`process.env` を読まない）、70（バイト列の文字列化は `src/json/reader.ts`・`src/op/environment.ts`・`src/op/runner.ts`（stderr）だけ）、71（ファイルの書き込みは `src/cli/install.ts` だけ）。
- **動作確認用 DSH で確かめたこと**: 起動時に実際の 2.42.0 の zip を取得・検証して `<DSH_HOME>/bot-vault-1password/op/2.42.0/op`（0700、SHA-256 一致）に入れ、状態が「利用可能」になる。形だけ正しい偽のトークンで口座を追加すると、本物の op が「1Password did not accept the service account token (revoked, expired or mistyped) (op whoami)」で断り、トークンの一部はメッセージに出ない。DSH の環境に `OP_CONNECT_HOST` / `OP_CONNECT_TOKEN` を置いても op には渡らない（Connect へ行かずにトークンのエラーになる）。
- **本物での確認**: 本物のサービスアカウントでは確かめていない（テストは偽の op）。確かめる手順は `docs/1password.md` の末尾。
