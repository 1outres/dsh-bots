# ボットのモデル設定 仕様

状態: Host 側を実装済み（`feat/bot-models`）。Web UI（BOT の設定の「モデル」、New bot ダイアログ、BOT セッションからの DSH のモデル選択の除去）を実装済み（`feat/bot-model-settings`、「9.」）。

## 目的

- BOT ごとに「役割 → モデル」を持ち、bot-core がその役割のセッションをそのモデルで作る。
- Main の作成では作成直後に挨拶ターンが走り、New session（`bots.createSession`）も作ってすぐ書けるので、作る前にモデルが決まっていなければならない。
- 将来 Main が別のセッション（BOT 自身の通常セッション、DSH の普通のワークスペースのセッション）を起動するときに選べるモデルの一覧と、
  情報の整形などに使う軽いモデルもここに置く。
- fallback は無い。使えないモデルの代わりに DSH の既定や別のモデルを使うことはしない。「DSH プロファイルの既定に従う」は明示的な選択肢の一つとして持つ。

## 1. 役割と選択肢（`src/shared/models.ts`）

```ts
const BOT_MODEL_ROLES = { main: "one", utility: "one", delegates: "list" } as const

interface BotModelSelection { provider: string; model: string; reasoningEffort?: string }

type BotModelChoice =
  | { kind: "profile-default" }                 // DSH の agentDefaultModel（使うときの値）
  | { kind: "fixed" } & BotModelSelection       // DSH の LLM 登録で確かめた 1 経路

type BotModelSettings = { main: BotModelChoice; utility: BotModelChoice; delegates: readonly BotModelChoice[] }
type BotModelsChange = Partial<BotModelSettings> // 名前を挙げた役割だけ丸ごと置き換える

const DEFAULT_BOT_MODELS = { main: profile-default, utility: profile-default, delegates: [] }
```

| 役割        | 数                          | 意味                                                                                               | 今の消費者                   |
| ----------- | --------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------- |
| `main`      | 1                           | Main セッションと `Bot.createSession` が作るセッション（New session、schedule の separate 実行も） | createAgent                  |
| `utility`   | 1                           | 情報整形などに使う軽いモデル                                                                       | 無し（保存・検証・取得のみ） |
| `delegates` | リスト（最大 32、重複不可） | BOT が起動するセッションで選べるモデル                                                             | 無し（同上）                 |

役割を増やすときは `BOT_MODEL_ROLES`、`DEFAULT_BOT_MODELS`、保存スキーマ（`host/models/domain.ts`）に足す。
保存済みの BOT は起動時にその役割の既定値で補われる（「3. マイグレーション」）。

入力（Remote・`bot` サービス）は信用しない: 知らない役割、形の違う値、空文字列や 256 文字を超える id、未知のフィールドは
`gateway/bad-request`（サービスでは Error）で拒否する（`parseModelsChange`）。

## 2. 保存（`host/models/`）

- ストレージドメイン `dsh_bot_models`（version 1）、テーブル `models`、キーは bot id。値は `{ roles, mainPending?: true, updatedAt }`。
  書くのは `host/models/store.ts` だけ（設計ルール 51）。
- BOT の作成時、レコードの直後（コネクタの有効化の前、BOT を告知する前）に書く。作成が失敗して巻き戻すときは消す。
- BOT を消すと行も消える（`forgetDeleted` の purge）。
- 読み手は行が無いか役割が欠けていれば例外を投げる（既定値で代用しない。補うのは起動時のマイグレーションだけ）。行は作成とマイグレーションで必ずできる。

## 3. マイグレーション

- 起動時（`migrateTimezones` と同じく、何かが BOT を読む前）に、行の無い BOT 全部に `DEFAULT_BOT_MODELS` を書く。
  役割が欠けた行（後で役割が増えたとき）はその役割の既定値で補って書き直す。
- 既存 BOT の振る舞いは変わらない: これまでのセッションも DSH の既定を live getter で使っていた。`profile-default` は同じ作り方をする（「4.」）。
- 既存の Main セッションには何もしない（`mainPending` も立てない）。今記録されているモデルのまま。
- 新しい BOT は `bots.create` の `models`（省略可、名前を挙げなかった役割は既定値）で始まる。

## 4. セッションの作り方（`createAgent`）

`Bot.createSession` は realizer の turn の中で `main` を解決してから Agent を作る（`host/preset/session.ts` の `model` 依存）。

- `fixed`: DSH の登録で確かめる（「6.」）。使えなければセッションを作らずに `BotModelsError`（コードは「6.」）で失敗する。
  使えるなら `agentOptions` にその経路を渡し、setup の中で `agent.model.select()` してセッションに `model/selection` を記録する
  （dsh-agent-loop の設定経路 `applyConfiguredRoute` と同じ）。記録があるので resume（セッションコントローラは既定の live getter を渡す）でも変わらない。
- `profile-default`: DSH のセッションコントローラと同じく `agentDefaultModel.currentSelection()` の live getter を `agentOptions` に渡し、記録はしない。
  最初のリクエストまでは DSH の既定の変更に従い、その後はリクエストヘッダーの経路に固定される（DSH 自身のセッションと同じ）。
  作るときに DSH の既定を確かめはしない（DSH も確かめない。使えなければ最初のターンが DSH のエラーで失敗する）。
- Main の作成（BOT の作成、Main の修復）も `Bot.createSession` なので同じ。作成後、作成に使った `main` で `mainPending` を下ろす。
- サブエージェントは DSH の規則のまま（親の経路を引き継ぐか、ツールで選ぶ）。

## 5. 設定変更と live セッション

DSH の事実（0.2.2-rc.5）:

- `AgentModel.current()`（dsh-agent `model-selection.ts`）は記録された選択（`pending ?? lastUsed`）を `agentOptions` より優先する。
  記録が無ければ `agentOptions` の getter を読む。
- エージェントループはステップごとに `model.current()` を読む（dsh-agent-loop `agent.ts` `preStep`）。`agent.model.select()` は
  `model/selection` を追記し、次のステップから効く（走っているターンなら次のステップから）。経路が変わると `installModelSelection` が
  「[model changed: …]」の通知をモデルに渡す。
- DSH の `session.selectModel`（モデルピッカー）は確認のあと `agent.model.select()` し、さらにプロファイルの既定を保存する。
  bot-core はプロファイルの既定を書かない。

決めたこと:

- **`main` を名前に挙げた変更だけが Main に効く。** `configureModels` が `main` を含めば（同じ値でも）`mainPending` を立てて保存し、
  Main の Agent が読み込まれていれば直ちに、いなければ次に作られたとき（`agent/created`、resume を含む。その listener の中で、Agent がターンを始める前）に、その時点で解決・確認した経路を
  `agent.model.select()` で記録してから `mainPending` を下ろす（`host/models/main.ts`）。Main を眠らせたまま resume はしない。
  `profile-default` を適用するときはその時点の DSH の既定を記録する（以後 DSH の既定が変わっても Main は追わない。追わせたいときは `main` を送り直す）。
- resume のときの確認は最大 10 秒待つ（プロバイダがモデル一覧に答えないと Main の resume が止まらないように）。超えたら resume は進み、適用は確認が終わったときに次のステップから効く。
- Main の作成中に `main` を変えた場合は、Main が記録された直後（挨拶を送る前）にもう一度適用を試す。
- 適用は一度だけ。その後 DSH のピッカーで Main のモデルを変えても、resume で設定に戻されることはない。
- 適用時に DSH が使えない経路（プロバイダが消えた等）なら警告を出し、`mainPending` のまま次の読み込みでもう一度試す。Main の今のモデルはそのまま。
- Main 以外の live セッション（New session、schedule の実行、fork）は作られたときのモデルのまま。設定変更は以後に作るセッションに効く。
- `utility`、`delegates` の変更は保存だけ（消費者がまだ無い）。
- 走っている bot-core の前の load から残った Main（再読み込み）は、起動時に全 BOT で一度適用を試す。

## 6. 検証（DSH の仕組み、`host/models/catalog.ts`）

DSH のモデルピッカーと `session.selectModel`（dsh-api-session-controller `catalog.ts` の `buildModelCatalog`・`modelAvailable`、`commands.ts` の `selectModel`）と同じ順で確かめる。名前を推測して作ることはしない。

1. `llm.listProviders()` にプロバイダがある。無ければ `bot-models/unknown-provider`。
2. `llm.listModels(provider)` がモデルを広告している（GUI がカタログ所属を要求するのと同じ）。一覧が取れなければ `bot-models/catalog-failed`、
   無ければ `bot-models/unknown-model`。
3. effort があれば `llm.resolveModelInfo(provider, model).reasoning.efforts` に含まれる。含まれなければ `bot-models/invalid-effort`。
4. 最後に `llm.resolveCallConfig({ provider, model, reasoningEffort })`（DSH が呼び出し前に行う検証）。拒否されれば `bot-models/rejected`。

いつ確かめるか: `fixed` を保存するとき（`configureModels`、`bots.create`。一つでも拒否されれば何も保存しない）、`fixed` の `main` で
セッションを作るとき、Main に適用するとき、`resolveModel` のとき。拒否の詳細は `{ role, index? }`（どの役割の何番目か）。

`llm` は bot-core の必須 inject になった（DSH の Host には常にある）。

## 7. 契約

### `bots` Remote（`shared/bots.ts`、`shared/remote-contract.ts`）

| メソッド                      | 返すもの                                                                                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `models(id)`                  | `BotModelsView` `{ botId, models, mainPending }`                                                                                                                                                                                      |
| `watchModels(id)`（stream）   | 今の `BotModelsView`、変わるたびにもう一度                                                                                                                                                                                            |
| `configureModels(id, change)` | 保存後の `BotModelsView`（`main` を含めば `mainPending: true` のことがある）                                                                                                                                                          |
| `modelCatalog()`              | `BotModelCatalog` `{ profileDefault, providers: [{ id, name, models: [{ id, name, description?, reasoning?: { efforts, defaultEffort? } }] }], failures }`（モデルが一つも無いプロバイダは出さない。一覧が取れないものは `failures`） |
| `create(input)`               | `input.models?: BotModelsChange` を受け取る（「3.」）                                                                                                                                                                                 |

拒否: `bot-models/not-found`、`unknown-provider`、`unknown-model`、`invalid-effort`、`catalog-failed`、`rejected`、`gateway/bad-request`。
`BotView` と `bots.watch` は変えていない。ブラウザ側は `client/remote.ts` の `BotsRemote` 型に `watchModels` の stream を足しただけ。

### `bot` サービス（`src/contract.ts`）

`models(botId)`、`configureModels(botId, change)`、`modelCatalog()`、`resolveModel(choice)`（`profile-default` は今の DSH の既定。確かめて返す）、
`onModelsChange(listener)`。将来の消費者（Main が起動するセッション、整形）は `resolveModel(models(id).models.utility)` のように使う。

## 8. 未解決・将来

- カタログの変更通知（`llm/adapters-updated`、`llm/models-updated`）はまだ stream にしていない。画面は開くたびに `modelCatalog()` を読む（「9.」）。
- BOT セッションの `/model` コマンド（「9.」の既知の制限）。
- `Bot.createSession` に `delegates` から選んだモデルを渡す口は、BOT が別セッションを起動する機能と一緒に作る（`createAgent` は既に `SessionModel` を受け取る）。
- `utility` の消費者。
- DSH の既定（`profile-default`）をセッション作成時に確かめないのは DSH に合わせた。

## 9. Web UI（`src/client/models/`、`src/client/settings/ModelsSection.tsx`）

デザインは `docs/specs/ui-design.md` に従う（即時保存、説明文なし、共有コンポーネントだけで組む）。

### BOT の設定「モデル」（Main session の次、`bot-core.models`、order 175）

- 1 つ目のグループ（タイトルなし）: 行「メイン」「補助」。行の右端にモデルピッカー（`SearchSelect`。先頭に「DSH の既定（<今の既定のモデル名>）」、
  その下にカタログのモデルをプロバイダ名の見出しごと）と、選んだモデルが effort を広告していれば effort の `Select`（「既定」＝ `reasoningEffort` なし、
  プロバイダが既定を名乗れば「既定（High）」、続いて広告された effort）。選んだ時点でその役割だけを `configureModels` で保存する。
  新しいモデルは effort なし（プロバイダの既定）で保存する。行の meta はプロバイダ名（`profile-default` なら今の既定のプロバイダ）。
- `mainPending` のあいだ、「メイン」の行に `StatusPill`（`idle`、「反映待ち」）を置く。nav のバッジは出さない（操作は要らない）。
- グループ「委任先」: 1 行に 1 つ（ラベルはモデル名、meta はプロバイダ名）。effort があれば行の `Select`（ほかの行と同じ選択になる effort は選べない）、
  `…` メニューに「上へ移動」「下へ移動」「削除」。最後の行は `AddRow`「モデルを追加」→ 下書きの行（モデルピッカーと effort、✓ で追加、× でやめる。
  既にある選択は ✓ が押せない）。どの操作もリスト全体を `configureModels({ delegates })` で保存する。
- 保存した `fixed` の経路をカタログが広告していないとき（プロバイダが消えた等）、その経路をピッカーの末尾に id のまま出し、行に `StatusPill`（`warning`、「利用不可」）を置く。
  代わりのモデルに置き換えはしない。
- カタログ（`modelCatalog()`）はページを開くたびに一度読む。読めるまでピッカーは無効（保存済みの選択は id で見える）。読めなければ `ErrorText`、
  一覧の取れなかったプロバイダ（`failures`）はそれぞれ `ErrorText` で示す。
- 拒否: 失敗した役割の行の meta（`danger`）に出す。`bot-models/*` は利用者向けの文（`models.refused.<code>`、en / ja）、それ以外（`gateway/bad-request`、接続の失敗）は
  「失敗しました: <message>」。委任先の拒否は details の `index` が指す選択を持つ行に、その行が無ければ下書きの行に、どちらも無ければグループの下に出す。
  次に受け付けられた保存で消える。
- 状態: BOT ごとの `watchModels` を設定画面が開いているあいだだけ購読する（`ModelsHub`、接続の世代が変われば開き直す）。保存は役割ごとに一つずつ（保存中はその役割の操作を無効にする）。

### New bot ダイアログ

アバターのグループの下に行「モデル」（同じピッカーと effort、既定は `profile-default`）。`bots.create` に `models: { main }` を渡す。
カタログが読めなければ `ErrorText` を出し、既定のまま作れる。`bot-models/*` の拒否はダイアログのエラーとして同じ文で出る。

### BOT セッションの DSH のモデル選択

DSH のモデル選択には入口が二つある（`@deepseek-ai/dsh-client-ui-model-selection` `src/client/index.ts`）: composer の single Slot
`conversation.input.model`（session スコープ、priority なしで登録）と `/model` コマンド。

- Slot: bot-core はメインビューが BOT のセッション（またはまだ分類できないセッション）を出しているあいだだけ、`conversation.input.model` に何も描かないエントリを
  `BOT_SESSION_PRIORITY`（`client/slot-priority.ts`、`Number.MIN_SAFE_INTEGER`）で登録する（`client/wiring/composer-seats.ts`、シェル・右サイドバーと同じ `createSlotRegistration`。権限選択の `conversation.input.permission` も同じ配線で空にする）。
  single Slot は最も低い priority が描くので、DSH のピッカー（0）だけでなく、ピッカーを全セッションで置き換えるプラグイン（`@1outres/dsh-plugin-model-picker` は -100）より下に来る。
  ほかのセッションでは登録を外すので、DSH のピッカー（または置き換えたプラグインのもの）がそのまま出る。
  拒否（ほかのプラグインが同じ `BOT_SESSION_PRIORITY` を使っている）は最終で、別の priority は試さず、Bots セクションに出す（`registration.refused.modelSeat`）。
  頼る DSH のファイル（ui-conversation の `contract/slots.ts`、`skeleton/InputBar.tsx`、ui-model-selection の `src/client/index.ts`）は `client/upstream.ts` に固定した。
- **既知の制限:** `/model` コマンドは `commandUi` にコマンドを隠す口が無いので BOT のセッションでも使える（DSH の `session.selectModel` はプロファイルの既定も書き換える）。
  Host 側で拒否する口も無い。DSH に口ができたら塞ぐ。

### 契約の変更

無し（`shared/models.ts`、Remote は変えていない）。ブラウザ側の `RemoteResult` の失敗に `details` を足した（DSH の Gateway は `code`・`message`・`details` を運ぶ）。
