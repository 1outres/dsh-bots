# ボットの Web 検索・フェッチ 仕様

状態: 実装済み（`feat/bot-web-impl`）。spike は済み（末尾「spike で確かめたこと」）。未解決事項だった「次のターンから」の仕組みは実装の最初に確かめて決めた（末尾「決めたこと」）

## 目的

ボットの `web_search` / `web_fetch` を、Host の `web` サービスとその設定（Web 検索・フェッチの設定画面、
Host の provider プラグイン、`DSH_WEB_*` 環境変数）から切り離す。

- ボットが何で検索・フェッチするかは bot-core が決める。Host の設定を変えてもボットは変わらず、その逆も無い。
- 外部 API へ送る backend は Host から送る。API キーは VM に置かない（宛先は API だけなので VM の ACL は意味が無い）。
- 使えない機能のツールは出さない。見えるのに必ず失敗するツールを作らない。fallback は無い
  （使えない backend の代わりに別の backend や Host の `web` を使うことはしない）。

現状（`main` b0300cd）: default テンプレートの `tool-web` 行はボットの `bot-environment` グループに入るが、
グループは `web` を isolate しないので Host の `@deepseek-ai/dsh-web`（dsh-base の行 `web`）を使う。
作者の環境（この仕様を書いた時点）では `@1outres/dsh-plugin-exa` が Host の `web` を `searchProvider: exa, fetchProvider: exa` にしている。
Host の `http` fetch provider を選ぶと、ボットのフェッチは Host のネットワークから出て、Host から届くプライベートアドレスにも届く
（作者環境での spike で、Host の LAN 上のアドレス `http://<Host LAN address>:3231/` に届いた。同じ要求は VM の中からは届かない）。

## 範囲

- 実装する backend は **Exa だけ**（検索もフェッチも）。dsh-bots の既定は検索もフェッチも Exa。
- Exa backend は新しいパッケージ `@1outres/dsh-bot-web` に**独自に実装する**。`@1outres/dsh-plugin-exa`（my-dsh-plugins）には
  依存せず、関数も借りない（中身が似るのは構わない）。
- bot-core に backend 登録のコントラクトを置き、`bot-web` が Exa を登録する。実行場所は今は `placement: "host"` だけ。
- キーと有効・無効は、dsh-bots 独自の **全体設定画面**（枠は `feat/global-settings` が先に入れる）の最初のタブ「Web lookup」で扱う。
- DeepSeek Search / Fetch API の backend と、VM の中で対象 URL を取りに行く HTTP fetch は**範囲外**（「8. 将来の拡張」）。

## 前提と配置

- 合成、有効・無効とキーの保存、状態、Remote、Web lookup セクションは **bot-core の中**（`src/web-contract.ts`、`shared/web.ts`、`host/web/`、
  `plugins/web.ts`、`client/web/`）。全体設定画面の枠は `feat/global-settings` のもの（「6.」）。ボットのグループの合成（`compose.ts`）と、
  グループ内に bot-core の行を置けるのは bot-core だけ（設計ルール 34 と同じ理由）。
- Exa の実装は bot-core の外、`@1outres/dsh-bot-web`（row id `bot-web`、`inject: ["bot"]`、`@1outres/dsh-bots` バンドルに入れる）。
- グループの中の `web` は DSH の `@deepseek-ai/dsh-web` をそのまま使い、その上の `tool-web` もテンプレートの行のまま使う。
  DSH や他リポジトリの provider プラグイン（`dsh-web-fetch-http`、`dsh-web-deepseek-api`、`@1outres/dsh-plugin-exa`）はグループに入れない。
  bot-core の行が、登録された backend を橋渡しする provider をグループの `web` に登録する（理由は「spike で確かめたこと」2）。

## 1. コントラクト（`src/web-contract.ts`、パッケージ入口から再エクスポート）

```ts
import type {
  WebFetchRequest,
  WebFetchResult,
  WebSearchRequest,
  WebSearchResult,
} from "@deepseek-ai/dsh-web"

type BotWebCapability = "search" | "fetch"

interface BotWebText {
  readonly en: string
  readonly ja?: string
}

interface BotWebSecretField {
  readonly key: string // camelCase。credential のペイロードのキー
  readonly label: BotWebText
}

interface BotWebCall {
  readonly botId: string
  readonly secrets: Readonly<Record<string, string>> // backend の secrets 全部（揃っていなければ呼ばれない）
  readonly signal: AbortSignal
}

interface BotWebOperation<Request, Result> {
  readonly placement: "host"
  run(request: Request, call: BotWebCall): Promise<Result>
}

type BotWebTestResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason:
        | "invalid-secret"
        | "no-credits"
        | "rate-limited"
        | "unreachable"
        | "unexpected"
      readonly message: string // 人が読む文。secrets を含めない
    }

interface BotWebBackend {
  readonly id: string // [a-z][a-z0-9-]*
  readonly name: BotWebText
  readonly description?: BotWebText // 費用、対象 URL を取りに行くのは誰か、できないこと
  readonly secrets: readonly BotWebSecretField[] // 1 件以上
  readonly search?: BotWebOperation<WebSearchRequest, WebSearchResult>
  readonly fetch?: BotWebOperation<WebFetchRequest, WebFetchResult>
  /** 接続テスト: secrets で一度だけ API に要求し、有効かを確かめる */
  test(call: {
    readonly secrets: Readonly<Record<string, string>>
    readonly signal: AbortSignal
  }): Promise<BotWebTestResult>
}
```

- `placement` は今は `"host"` だけ。`environment` は使う backend ができたときに判別共用体として足す（「8.」）。
- `search` と `fetch` の少なくとも一方を持つ。`registerWebBackend` が記述子を検証する（id の形、テキスト、secrets の key の形と重複、機能の有無）。
- 失敗は `WebError`（`@deepseek-ai/dsh-web`）で投げる。tool-web がそのまま `code` をツールのエラーに載せる。
- `run` は 1 回の操作。結果の上限（`maxResults`）は seam（dsh-web）が守る。タイムアウトは tool-web の
  `searchTimeoutMs` / `fetchTimeoutMs` が `signal` で伝える。backend は自分の上限（応答サイズ）を自分で持つ。

### `Bot` に足すもの（`contract.ts`）

```ts
interface Bot {
  /** @throws 記述子が不正、id が使用中のとき */
  registerWebBackend(backend: BotWebBackend): () => void
  webBackends(): readonly BotWebBackend[]
  webStatus(): BotWebStatus
  onWebChange(listener: () => void): () => void
}
```

有効・無効とキーの変更は Remote（「5.」）からだけ行い、`Bot` には出さない（他のパッケージが変える必要が無い）。

### 有効・無効（`shared/web.ts`）

backend が Exa だけの間、選択は機能ごとの有効・無効として表す。どの backend かは保存するが、選ぶ画面は無い。

```ts
interface BotWebSettings {
  readonly backend: string // 今は常に DEFAULT_WEB_BACKEND
  readonly search: boolean
  readonly fetch: boolean
}

const DEFAULT_WEB_BACKEND = "exa"
const DEFAULT_WEB_SETTINGS: BotWebSettings = {
  backend: DEFAULT_WEB_BACKEND,
  search: true,
  fetch: true,
}
```

### 状態（`shared/web.ts`）

```ts
type BotWebCapabilityStatus =
  | { readonly state: "ready"; readonly backend: string } // 使える
  | { readonly state: "disabled" } // 無効にしている
  | {
      readonly state: "missing-secrets"
      readonly backend: string
      readonly keys: readonly string[]
    } // キー未設定
  | {
      readonly state: "unavailable"
      readonly backend: string
      readonly reason: "not-registered" | "no-capability" | "no-credentials-service"
    }

interface BotWebStatus {
  readonly search: BotWebCapabilityStatus
  readonly fetch: BotWebCapabilityStatus
}
```

- 判定の順: `disabled` → `unavailable` → `missing-secrets` → `ready`。`ready` のときだけツールが見える。
- 計算は純粋関数（`host/web/status.ts`、入力は `BotWebSettings`・backend の一覧・secrets ごとの設定済みか・credentials の有無）。
  状態そのもの（設定、secrets の有無）は `host/web/` のストアが持ち、計算と分ける。
- `missing-secrets` の判定は credential の record の有無とペイロードのキー（値は Host の外に出さない）。

## 2. 保存

- 有効・無効: storage domain `dsh_bot_web`（version 1、`host/web/domain.ts`）、テーブル `settings` の 1 行（key `global`、
  `BotWebSettings`）。書くのは `host/web/store.ts` だけ（**設計ルール 44**）。スナップショット対象（ルール 27）。
  行が無い初回の起動で `DEFAULT_WEB_SETTINGS` を書き込んでから使い、以後は保存した値だけを読む。
- キー: backend ごとに DSH の credential store の record 1 件。key `bot-core/web-<backendId>`（connector の `bot-core/connection-…`、channel の `bot-core/channel-…` と重ならない）、`grant`、
  ペイロード `{ version: 1, secrets: Record<string, string> }`（channel の vault と同じ形。`host/web/vault.ts`）。
  全ボット共通。ブラウザには値を返さず、設定済みかだけを返す。backend の登録が外れても record は消さない。
- `credentials` サービスが無いとどの機能も `unavailable`（`no-credentials-service`）。

## 3. 合成

```
bot-environment（cordis:group、isolate: 既存 + web）
 ├─ 環境の行（env-…）
 ├─ env-bot-core-files / channel / connectors / schedule / prompt（既存）
 ├─ env-bot-core-web           @deepseek-ai/dsh-web     { searchProvider: "bot-core", fetchProvider: "bot-core" }
 ├─ env-bot-core-web-bridge    @1outres/dsh-bot-core/web { botId, token, backend, search: boolean, fetch: boolean }
 └─ テンプレート + overlay の行（tool-web を含む）
```

- `ENVIRONMENT_SERVICES` に `web` を足す。グループの中の `web` は `env-bot-core-web` のものだけになり、
  テンプレートや overlay の行が `web` を isolate / intercept することは既存の規則で拒否される。
- `env-bot-core-web` は provider id を常に `bot-core` に固定する。自動選択も `DSH_WEB_SEARCH_PROVIDER` /
  `DSH_WEB_FETCH_PROVIDER` も効かない（dsh-web は設定値を環境変数より先に読む）。
- `env-bot-core-web-bridge`（`plugins/web.ts`）は組み立てた機能ごとに id `bot-core` の provider を登録する（**設計ルール 45**:
  `registerSearchProvider` / `registerFetchProvider` はこのファイルだけ）。他の bot-core の行と同じくリビジョンの token で封をし、
  テンプレート・overlay・環境の行からは名指しできない。
  - `available()` は常に true。`ready()` はその機能がそのターンで有効で、backend の secrets がすべて設定済みか（credential の record を読むだけ、ネットワークに出ない）。
    tool-web はステップごとに `searchReady()` / `fetchReady()` を聞き、false のステップにはツールを出さない。
    だからキー未設定の間はツールが見えず、キーを入れると組み直さずに次のステップから見える
    （spike 2: キー未設定の exa で `ready()` が false になり、設定後に true になった）。
  - `search` / `fetch` は呼ばれるたびに backend を引き直し、キーを読み、`run` を呼ぶ。backend が外れていたら
    `WebError` `WEB_PROVIDER_UNAVAILABLE`、キーが消されていたら `WEB_PROVIDER_CREDENTIAL_MISSING` で断る。
- **tool-web の組み立て**: 合成後の行（入れ子を含む）の `@deepseek-ai/dsh-tool-web` 行すべてについて、
  `config.search` / `config.fetch` を「テンプレートの値（省略は true） かつ backend が登録済みでその機能を持つ」に書き換える。
  テンプレートと overlay は「使いたいか」を書き、bot-core が「backend が持つか」を掛ける。その他の config（タイムアウトなど）はそのまま。
  有効・無効とキーの有無は組み立てに入れない（`ready()` が受け持つ）。
- **反映**: backend の id と、backend が登録済みでその機能を持つかだけが合成の入力。これらが変わったら全ボットのプリセットを組み直す。
  ただし動いている Agent は始めたリビジョンのまま（「決めたこと」1）なので、**backend の登録・解除は動いている Agent には
  DSH の再起動（か bot-core の再読み込み）まで効かない**（新しいセッション、作り直された Agent から効く）。通常は起きない（バンドルに入っている）。
- **有効・無効**の変更ではプリセットを組み直さない。bridge の `ready()` と `search` / `fetch` は、呼び出し元の Agent（`agents.currentInitiator()`）の
  ターンの始まり（`turn/start`）に読んだ有効・無効をそのターンの間使う。だから有効にする・無効にする、どちらの方向も、動いている Main を含め
  全ボットの次のターンから効き、進行中のターンには影響しない。ターンの外の呼び出しはその時点の値を読む。
- キーの設定・置き換え・削除も組み直さず、次の呼び出し（と次のステップの `ready()`）から効く。
- bridge は bot-core がこの読み込みの間に登録したリビジョンの token をすべて受け付ける（connector の行と違い、登録中のリビジョンだけに絞らない）。
  動いている Agent は古いリビジョンの bridge を使い続けるため。
- **テンプレート・overlay で拒否するパッケージ**に足す: `@deepseek-ai/dsh-web`、`@deepseek-ai/dsh-web-fetch-http`、
  `@deepseek-ai/dsh-web-deepseek-api`、`@deepseek-ai/dsh-web-search-deepseek`、`@1outres/dsh-plugin-exa`、`@1outres/dsh-bot-web`。
  provider を持ち込む行は bot-core の設定と credential を迂回するため。理由の文は「provides the bot's web seam outside bot-core's settings」。
  これら以外の provider パッケージは名前で判別できない。`bot-core` 以外の id で登録されても選ばれないので使われない
  （同じ id は bot-core の行が先に登録しているので `WEB_DUPLICATE_PROVIDER` でその行が失敗する）。
- `allowedHostTools` に `web_search` / `web_fetch` を入れる道（Host の web を使う）は残るが、README で使わないよう書く。

## 4. Exa backend（`@1outres/dsh-bot-web`、`src/exa/`）

Exa の部分はパッケージ内のライブラリとして切り出し、DSH のサービスにも bot-core にも依存しない
（`src/exa/` が import するのは `@deepseek-ai/dsh-web` の型と `WebError` だけ）。bot-core とつなぐのは `src/index.ts` だけ。

| モジュール       | 役割                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------- |
| `exa/options.ts` | `ExaOptions` と固定値 `EXA_OPTIONS`                                                                           |
| `exa/request.ts` | `WebSearchRequest` / `WebFetchRequest` / 接続テスト → Exa の要求本文（純粋）                                  |
| `exa/map.ts`     | Exa の応答 → `WebSearchResult` / `WebFetchResult` / `BotWebTestResult` の理由（純粋。信用しない JSON を検証） |
| `exa/client.ts`  | `POST {baseURL}{path}`、`x-api-key`、`redirect: "error"`、HTTP エラーの分類（`fetch` 関数を受け取る）         |
| `exa/exa.ts`     | 上を組み合わせた `search(request, { apiKey, signal })` / `fetch(...)` / `test(...)`                           |

```ts
interface ExaOptions {
  readonly baseURL: string
  readonly searchType: "auto" | "lite" | "deep-lite" | "deep"
  readonly searchContents: "highlights" | "text"
  readonly searchMaxCharacters: number
  readonly fetchMaxCharacters: number
}

const EXA_OPTIONS: ExaOptions = {
  baseURL: "https://api.exa.ai",
  searchType: "auto",
  searchContents: "highlights",
  searchMaxCharacters: 1000,
  fetchMaxCharacters: 100000,
}
```

- `EXA_OPTIONS` は固定値。画面にも行の config にも出さない（必要になったら足す。「8.」）。ドメインの絞り込みは送らない。
- 検索: `POST /search`、`{ query, type, numResults, contents }`。`numResults` は `request.maxResults`（無ければ 10）を 1–100 に収める。
  結果は URL ごとに 1 件（Exa の順）。highlights は最初を `snippet`、全部を `" … "` でつないで `summary`。`publishedDate` は `publishedAt`。
  Exa の notices は `content` に足し、warnings は Host のログへ。
- フェッチ: `POST /contents`、`{ urls: [url], text: { maxCharacters: fetchMaxCharacters + 1 } }`。
  `statuses` が error で `httpStatusCode` があれば、その status と空の本文を結果で返す（seam の「非 2xx は結果」に合わせる）。
  それ以外の error は `WEB_PROVIDER_ERROR`。本文は `{ kind: "text" }`、`fetchMaxCharacters` を超えたら切って `truncated`。
  対象 URL を取りに行くのは Exa のサーバー（ボットの VM でも Host でもない）。
- 接続テスト（`test`）: `POST /search` に `{ query: "Exa", type: "auto", numResults: 1, contents: { highlights: { maxCharacters: 100 } } }`。
  2xx で `ok: true`。401/403 は `invalid-secret`、402 は `no-credits`、429 は `rate-limited`、接続できない・中断は `unreachable`、
  それ以外（応答が JSON でない、`results` が無い、その他の status）は `unexpected`。1 回分の検索として課金される。
- エラー（検索・フェッチ）: 401/403（キーが違う）、402（クレジット切れ）、429 は文を分けた `WEB_PROVIDER_ERROR`。中断は `WEB_ABORTED`。
  どの文にもキーを入れない。
- テストは `request` と `map` を表で、`client` は偽の `fetch` で。

## 5. Remote（`botWeb`）

`shared/remote-contract.ts` に宣言し、strict 定義で登録する（既存の Remote と同じ）。

| メソッド                          | 戻り値             | 内容                                                                                           |
| --------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `view()`                          | `BotWebView`       | 今の値                                                                                         |
| `watch()`（stream）               | `BotWebView` の列  | 変わるたびに                                                                                   |
| `setEnabled(capability, enabled)` | `BotWebView`       | 書き込みキューで保存する（組み直さない。各 Agent の次のターンから効く）                        |
| `setSecret(key, change)`          | `BotWebView`       | 今の backend の secret を `{ op: "set", value }`（設定・置き換え）か `{ op: "clear" }`（削除） |
| `test()`                          | `BotWebTestResult` | 今の backend の `test` を保存済みのキーで呼ぶ                                                  |

```ts
interface BotWebView {
  readonly backend: {
    readonly id: string
    readonly name: BotWebText
    readonly description?: BotWebText
    readonly capabilities: readonly BotWebCapability[]
    readonly secrets: readonly {
      readonly key: string
      readonly label: BotWebText
      readonly set: boolean
    }[]
  } | null // 未登録
  readonly settings: BotWebSettings
  readonly status: BotWebStatus
}
```

- 失敗は `bot-web/unknown-secret`、`bot-web/missing-secrets`（キー未設定で `test()`）、`bot-web/not-registered`、
  `bot-web/no-capability`、`bot-web/busy`（実行中の `test()` がある）、`bot-web/unavailable`（credentials 無し）、`gateway/bad-request`。
- `set` の値は前後の空白を除き、空なら `gateway/bad-request`。`test()` のタイムアウトは 15 秒。

## 6. 画面

### 全体設定画面（`feat/global-settings` が先に入れる）

全体設定画面の枠は **`feat/global-settings` で先に入る**。bot-web はそこに Web lookup セクションを登録するだけで、枠には手を入れない。
枠について bot-web が前提にするのは次のことだけ（名前と置き場所は `feat/global-settings` の実装に従う）:

- ボットごとの設定画面（`client/settings/`）と同じ全画面の形と左タブの仕組みを持つ、ボットごととは別の画面。
- セクションを `{ id, order, label, icon, component, badge? }` で登録でき、component は `{ t, reportDirty, close }` を受け取る
  （ボットを受け取らない）。`badge` は nav に出る印。
- サイドバーの Bots 見出し（⚙）と DSH の設定画面の dsh-bots のページ（「dsh-bots の設定を開く」ボタンだけ）から開く。
  セクションの badge が出ている間、⚙ にも印が付く。

bot-web が足すのは、最初のセクション「Web lookup」（`client/web/`）の登録（`client/wiring/web.ts`）だけ。

### Web lookup セクション（`client/web/`）

状態は `client/web/model.ts`（`watch()` の購読、入力中のキー、保存中、テストの結果）、表示は `WebLookupSection.tsx`。

- **Exa API キー**: 「設定済み」/「未設定」だけを表示し、値は表示しない。未設定なら入力欄と「保存」。
  設定済みなら「置き換え」（入力欄を開く）と「削除」（確認してから `clear`）。入力中で未保存なら `reportDirty(true)`。
  保存先は bot-core の credential（`setSecret`）。
- **検索 / フェッチ**: それぞれのスイッチ（有効・無効）。押すとすぐ保存（`setEnabled`）し、「全ボットの次のターンから反映」と添える。
- **状態**: 機能ごとに「使える」/「キー未設定」/「無効にしている」/ 使えない理由（backend が入っていない など）。
  **キー未設定は警告として「Exa の API キーが未設定のため、ボットは検索・フェッチを使えません」と明示する**。
- **接続テスト**: キーが設定済みで、入力中の未保存のキーが無いときだけ押せる（保存済みのキーを試す）。
  結果は「キーは有効です」か理由ごとの文。1 回分の検索として課金されると添える。
- backend の説明（Exa のサーバーが対象 URL を取りに行くこと、費用）。
- badge: 有効な機能のどれかが `ready` でなければ `warning`。

## 7. 既存ボットへの影響

- 移行後の最初の起動で `DEFAULT_WEB_SETTINGS`（Exa、検索・フェッチとも有効）が書き込まれる。ボット用の Exa のキーはまだ無いので、
  両機能は「キー未設定」になり、既存ボットの `web_search` / `web_fetch` はキーを入れるまで見えない。
  全体設定画面の Web lookup と Bots 見出しの ⚙ の印でキー未設定を知らせる。
- Host の Exa のキー（`EXA_API_KEY` の credential や環境変数）は写さない。ボットの credential を Host から独立させるのが目的のため。
  README の移行手順に「dsh-bots の設定 → Web lookup で Exa のキーを入れる」と書く。
- `@1outres/dsh-bot-web` が入っていなければ「使えない（backend が入っていない）」。`@1outres/dsh-bots` バンドルに入れるので通常は起きない。
- `ENVIRONMENT_SERVICES` と bot-core の行が増えるので全ボットのリビジョンが一度変わる。
  overlay の `remove tool-web` / `replace tool-web` はそのまま適用できる。

## 8. 将来の拡張（範囲外）

- **backend の選択**: backend が二つ以上になったら `BotWebSettings.backend` を画面で選べるようにし、機能ごとに別の backend を選べる形に
  するかをそのとき決める（storage の version を上げる）。
- **DeepSeek Search / Fetch API**: `dsh-web-deepseek-api` は `DeepSeekSearchApiProvider` / `DeepSeekFetchApiProvider` を公開しており、
  auth に API キーの source を一つ渡せば Host の model route を使わずに動かせる見込み（Host 実行）。
- **VM の中の HTTP fetch**: `placement` に `environment` を足し、`@1outres/dsh-bot-vm` が backend を登録する。connector の環境アクセス（`BotConnectorEnvironment`、
  `host/connectors/environment.ts`: ボットの環境の `subprocess` を呼ぶたびに引き、stdin を pipe で渡せる）と同じ道で VM の node にイメージの `dsh-web-fetch-http` の `HttpFetchProvider` を動かす（spike 4 で動作と ACL を確認済み）。
  VM のイメージの DSH の版が Host とずれる問題と、その確かめ方は、そのときに決める。
- **Exa の検索オプション**（件数、検索の種類、本文上限、ドメインの絞り込み）を画面に出す。

## 9. 実装の順序

1. bot-core: `web-contract.ts` と `shared/web.ts`、`host/web/`（domain / store / vault / catalog / status / tester）、
   `ENVIRONMENT_SERVICES` に `web`、`env-bot-core-web` と `plugins/web.ts`、tool-web の組み立て、拒否パッケージ、設計ルール 44・45、
   Remote `botWeb`。
2. bot-core の画面: `feat/global-settings` の全体設定画面に Web lookup セクションを登録する（`feat/global-settings` が main に入ってから）。
3. `@1outres/dsh-bot-web`: `exa`。バンドル `@1outres/dsh-bots` に追加。
4. README（bot-core の Composition・Known limits・Web lookup、移行手順、ルート README の設計ルール表（44・45）とパッケージ表）。

## spike で確かめたこと

作者の環境での検証記録。アドレス・パス・バージョン・provider の構成はその環境のもので、ほかの環境で同じになるとは限らない。

`dev/web-probe`（検証専用。ビルド・公開・バンドルされない）を、`/tmp/dsh-bot-web-spike` に立てた検証用 DSH
（0.2.2-rc.5、Host に exa を入れ Host の `web` は exa/exa、Host の exa は `EXA_API_KEY` を環境から読む）に入れて確かめた。
Agent プリセット `webspike` に `cordis:group`（`isolate: { web: true }`）を置き、その中に
`@deepseek-ai/dsh-web`（`searchProvider: probe-bot, fetchProvider: exa`）、`@1outres/dsh-plugin-exa`
（`apiKeyEnv: BOT_WEB_EXA_KEY`、`baseURL` は probe の偽 Exa）、`dsh-web-fetch-http`、`dsh-web-deepseek-api`、probe（search provider `probe-bot`）、
`tool-web` を入れた。ボットのグループと同じ isolate の仕組み（bot-core はまだ `web` を isolate しないので、プリセットの group で再現）。

1. **Host と衝突しない**。
   - グループの `ctx.web` は Host の `ctx.web` と別のインスタンス。Host の provider 一覧は
     `search: deepseek-official, deepseek-search-api, exa / fetch: deepseek-fetch-api, http, exa` のまま、
     グループは `search: probe-bot, deepseek-search-api, exa / fetch: deepseek-fetch-api, http, exa`。
     同じ id（`exa`、`http`…）が両方にあっても `WEB_DUPLICATE_PROVIDER` にならない（registry はインスタンスごと）。
   - Remote の `web` 名前空間は Host のものだけ。Gateway は自分の（Host の）context から `ctx.get(serviceKey)` で Service を探すので、
     isolate されたインスタンスは候補に入らず `gateway/ambiguous-endpoint` も起きない（`dsh-api-gateway` `resolveSrcDescriptor`）。
     Web 検索・フェッチの設定画面の Search メニューは「DeepSeek Search API / DeepSeek server-side search / exa」だけで、`probe-bot` は出なかった。
   - 設定（`settings.describe()`）の名前空間に、グループの行（`spike-web`、`spike-exa`）は出ない。プリセットの中の行は
     `configEditor.configuration()` に無いため。設定画面からグループの `web` や exa は編集できない＝bot-core が config を持つしかない。
   - **`web/providers-changed` は境界を越える（両方向）**。グループの登録ごとに Host のリスナーも呼ばれ、Host の登録ごとにグループのリスナーも呼ばれた。
     イベントにペイロードは無く、受けた側は自分の `listProviders()` を読み直すだけなので害は無い（設定画面が余分に読み直す程度）。
2. **既存 provider の二重マウントは動くが、使い回さない**。
   - exa はグループ内で二重に登録でき、`settings.configure({ auto: false }, fiber)` も別 fiber なので throw しない。
     グループの exa は `BOT_WEB_EXA_KEY`（`x-api-key: bot-secret`）、Host の exa は `EXA_API_KEY`（`host-env-secret`）を送り、混ざらなかった。
     キー未設定では `ready()` が false、呼ぶと `WEB_PROVIDER_CREDENTIAL_MISSING`。
   - 使い回さない理由: (a) exa・DeepSeek の provider は credential を **ref**（環境変数名の空間。store の次に環境変数・`.env`）で読み、
     bot-core の **record**（`bot-core/…`）を読めない。ref は Host と共有の名前空間で、Host の設定画面からも同じ名前を指せる。
     (b) DeepSeek の provider は Host の model route（Models ページのキー、アカウント token、`llm` と `loader` の行）から credential と宛先を決める。
     (c) `dsh-web-fetch-http` は Host のネットワークから出る。(d) 実行場所を宣言する仕組みが無い。(e) グループの行の config は画面から触れない。
     よって bot-core 独自の backend コントラクト（1）を作り、グループの `web` には橋渡しの provider だけを置く。
     Exa は `@1outres/dsh-plugin-exa` に依存せず `bot-web` が自前で持つ（4）。
3. **グループ内の tool-web はグループの web だけを使う**。probe が `tools.get("web_search", scopeOf(ctx))` で取った定義を直接実行すると
   `probe-bot` が呼ばれ、`web_fetch` はグループの exa（`bot-secret`）で取った。どちらも scope 付きの登録で、global の `tools.get()` には無い。
4. **VM 内フェッチ**（将来の拡張のための確認。今回は範囲外）: `dsh-bot-base` から一時 VM（`-p dsh-bot`、`--ephemeral`）を起こし、Node 24 とイメージの
   `dsh-web-fetch-http` で上の ESM を動かした。`https://example.com/` は 200、`http://github.com/` は Host と同じ
   `WEB_REDIRECT_BLOCKED`（別オリジンへのリダイレクト）、`http://<Host LAN address>:3231/` と `http://169.254.169.254/` は
   ACL で `WEB_PROVIDER_ERROR`（fetch failed）。同じ ESM を Host で動かすと `<Host LAN address>:3231` に届いた（401）。
   VM は検証後に止めて消した。
5. **bot-core の規則との整合**: `web` を `ENVIRONMENT_SERVICES` に足せば、テンプレート・overlay が `web` を isolate / intercept する行は
   既存の `environmentEscapeProblem` で拒否される。`env-` の id、封をした bot-core の行、拒否パッケージの仕組みはそのまま使える。
   `dsh-tool-web` は Host で実行されるパッケージではない（グループの `web` を呼ぶだけ）ので拒否しない。

## 決めたこと

1. **「次のターンから」の仕組み**（旧・未解決事項 1。実装の最初に確認用 DSH で確かめた）: ボットの Main が動いている状態で overlay を変えて
   プリセットを組み直し（再登録は ready: true）、Main で 1 ターン回したところ、Main の Agent のツール（`tools.definitions(agent)`）は
   ターンの前後とも古いリビジョンのままだった。dsh-agent-preset-registry は生きている Agent に generation を持たせ続け（`select` は空のセッションだけ）、
   DSH にアイドルな Agent を退避する仕組みも無いので、動いている Main は DSH の再起動まで古いリビジョンのまま。
   有効・無効を合成に入れると「有効にする」方向が動いている Main に効かないため、ユーザの決定により、有効・無効は合成に入れず、
   bridge がターンの始まりに読む形にした（§3「反映」）。合成に入るのは backend が登録済みでその機能を持つかだけで、その変化だけは
   動いている Agent に再起動まで効かない（§3）。
