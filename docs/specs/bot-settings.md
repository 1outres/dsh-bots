# ボットが自分の設定を知り、変える（`bot_settings`）

2026-11-26 の検討（docs/specs/bot-discord-home.md の続き）を基にした仕様。実装で確定したことは末尾の「9. 実装で確定したこと」に書く。

## 1. 考え方

- ボットは自分の設定を **利用者の目線**（Web UI でどう見えるか、どこにあるか）と **自分の目線**（その設定が自分の動きに何を意味するか）の両方で知っている。「Discord の通知を日本語にしたい」と言われたら、どの設定かが分かり、変えるか、どこで変えるかを案内できる。
- 説明は手で書いたスキルにしない。各機能が設定の定義に持つ説明から、そのつど組み立てる。定義と説明がずれない。ボットのスキルは workspace の `skills/` だけ、という bot-skills.md の決まりにも触れない。
- 変えられるかどうかは設定ごとに決める。**そのまま変えてよい**、**オーナーの承認が要る**、**ボットからは変えられない** の 3 つ。
- ボットが変えた設定は履歴に残り、オーナーは Web UI から戻せる。

## 2. 設定の目録（contract）

bot-core に「設定の目録」を作る。各機能（ボットの基本、モデル、チャネル、コネクター、スキル…）が **区画**（`BotSettingsArea`）を登録し、区画は項目を並べる。

```ts
interface BotSettingsArea {
  readonly id: string // "general", "channels.discord", "connectors.gmail"…
  readonly label: BotChannelText // Web UI での名前
  readonly location: BotChannelText // Web UI での場所（例: "ボットの設定 > チャネル > Discord"）
  entries(botId: string): Promise<readonly BotSettingEntry[]>
  apply(botId: string, changes: readonly BotSettingChange[]): Promise<BotSettingApplyResult>
}

interface BotSettingEntry {
  readonly key: string // 区画の中で一意
  readonly label: BotChannelText // 利用者に見える名前
  readonly description?: BotChannelText // 利用者に見える説明（Web UI と同じ文）
  readonly agentNote: string // ボット向けの説明（英語 1〜2 文）
  readonly value: BotSettingValue // 今の値（人やチャンネルは名前で。秘密は設定済みかどうかだけ）
  readonly accepts?: BotSettingValueShape // 変えられる項目の値の形（選択肢、範囲）
  readonly change: "free" | "approve" | "never"
}
```

- 区画を登録するのは bot-core 自身の機能と、チャネルとコネクターのプラグイン。チャネルとコネクターの項目は、それぞれの設定の定義（`BotChannelField`、コネクターの設定項目）に `agent: { note, change }` を **必須** で持たせ、bot-core がそこから区画を作る。秘密の項目は `change` を持たず、常に `never`。
- `apply` は Web UI の保存と同じ道（同じ検査、同じ `check`、同じ保存）を通る。ボットのための別の書き込み口は作らない。
- 一度の `apply` は同じ区画の中のいくつかの項目をまとめて変える（例: Discord のホームを変えるとオーナーも選び直す）。

## 3. 何をどこまで変えられるか（初期の割り当て）

| 区画                                                            | 項目                                         | 変更    |
| --------------------------------------------------------------- | -------------------------------------------- | ------- |
| 基本                                                            | 名前                                         | approve |
| 基本                                                            | アバター                                     | never   |
| 基本                                                            | 言語、タイムゾーン                           | free    |
| モデル                                                          | Main と各用途のモデル、推論の強さ            | approve |
| チャネル（Discord）                                             | 通知の言語                                   | free    |
| チャネル（Discord）                                             | オン・オフ、ホーム、オーナー                 | approve |
| チャネル（Discord）                                             | トークン                                     | never   |
| コネクター                                                      | オン・オフ、設定項目                         | approve |
| コネクター                                                      | ツールの許可を厳しくする（allow → ask など） | free    |
| コネクター                                                      | ツールの許可を緩める（ask → allow など）     | approve |
| スキル                                                          | 裏での振り返りのオン・オフ                   | free    |
| ログイン（vault）                                               | ログインの名前と種類を読むだけ               | never   |
| 環境、ワークスペース、Main の入れ替え、Web lookup（全体の設定） | 読むだけ                                     | never   |
| ハートビート（docs/specs/bot-heartbeat.md）                     | オン・オフ、間隔、時間帯                     | free    |

- `free` でも、§4 の条件を満たさなければ変えられない。
- 割り当ては各区画の定義に書く。この表はその初期値。

## 4. 誰の依頼で変えるか

- `bot_settings` を出すのは Main と Web セッションだけ。スケジュールの単独実行とサブエージェントには出さない（`skill_manage` と同じ）。
- `change` を受け付けるのは、**今のターンを始めた発言がオーナーのもの** のときだけ。オーナーのものとは、見出しに `owner` が付いた発言か、見出しの無い Web UI の発言。
  - そのターンにオーナー以外の発言が混じったら（steer で入った）、`free` の項目も承認が要る。
  - オーナーの発言でないターン（ほかの人の発言、スケジュールやコネクターのお知らせ）では、`change` を断る。断りの文は「オーナーに頼まれたときだけ変えられる」。
- `describe` はいつでも使える。返す中身は設定の値だけで、メールの本文やログインの秘密は入らない。

## 5. 承認

- `approve` の項目は DSH の承認（ツールの pre-execute の `ask`）で聞く。`displayReason` に「何を、今の値 → 新しい値（名前で）、理由」を書く。
- 承認のカードは、ほかの承認と同じく Web UI とチャネル（Discord ならホーム。押せるのはオーナーだけ）に出る。
- 承認されたら `apply`、断られたらツールの結果で伝える。承認待ちは失敗ではない（コネクターの操作と同じ扱いをプロンプトに書く）。

## 6. ツール `bot_settings`

- `action: "describe"`、任意で `area`。省くと区画の一覧と、それぞれの項目の 1 行の要約。`area` を付けると、その区画の項目を詳しく。
- `action: "change"`、`area`、`changes: [{ key, value }]`、`reason`。値は `accepts` の形で検査する。
- `describe` の 1 項目の書式（例）:

```text
channels.discord / language — "Notice language"（Web UI: ボットの設定 > チャネル > Discord > 通知の言語）
  For you: the language of your own notices and cards in Discord; your replies follow the person you answer.
  Now: 日本語 (ja). Choices: "" (default, English), en, ja.
  Change: free (when your owner asks).
```

- 利用者向けの名前と場所は、ボットの言語（基本の「言語」）で出す。利用者にそのまま案内できるように。

## 7. 変更の履歴と取り消し

- ボットが `apply` した変更を記録する: 日時、区画と項目、前の値と後の値、理由、承認した人（承認が要ったとき。Web UI か、チャネルとその人）、セッション。
- Web UI のボットの設定に「ボットが変えた設定」を出す（新しい順）。各行に **元に戻す**。戻すのはオーナーの操作なので承認は要らず、同じ `apply` の道で前の値を書く。その後に値が変わっていたら、戻せないことを示す。
- 記録はボットを消すまで残す（件数の上限は実装で決める）。

## 8. プロンプト

- `## Your environment` の「You cannot change them yourself.」の行を、次の趣旨に替える: 設定はオーナーが Web UI で管理している。`bot_settings describe` で読める。オーナーに頼まれたときは `bot_settings change` で変えられる。オーナーの承認を待つものも、変えられないものもある。変えられないものは、オーナーに Web UI のどこで変えるかを伝える。
- 承認待ちは失敗ではない、という行をコネクターの操作の行とまとめる。

## 9. 実装で確定したこと

**承認（§5 から変えたこと）**

- **DSH の pre-execute の `ask` は使わなかった**。ボットのセッションは承認の方針が `never`（`BOT_PERMISSION`）で、DSH の `ApprovalService` は方針が `never` のとき answerer に渡す前に `rejected` を返す（`dsh-user-approval` の `decide`）。`ask` を返すと誰にも聞かずに断られる。方針を `ask` にするとボットのほかのツールの承認まで変わるので、方針は変えない。
- 代わりに `bot_settings` の実行の中で、bot-core の interaction board に承認（`kind: "approval"`、subject `bot_settings`）を開く（`host/settings/approval.ts`）。ほかの承認と同じカードで、Web UI と、Main セッションならチャネル（Discord はホーム、押せるのはオーナーだけ）に出る。問いは「ボットの設定「<区画>」を変更しますか？」、詳細は項目ごとの「名前: 今の値 → 新しい値」（名前で）と理由。en / ja を持つ。ボタンは **変更する** / 拒否。
- 呼び出しは答えを待つ（DSH の `ask` と同じく、待っているあいだツールは終わらない）。ターンが止まったら承認を取り下げ、「答えの前に取り下げられた」で失敗にする。断られたら「オーナーが断った。別の方法で変えない」で失敗にする。
- 適用の前に値を読み直す。承認を待つあいだなどに値が変わっていたら変えない（「もう一度 describe してから」）。
- Main セッションが `session_answer` で答えること（出どころ `main`）は受けない。答えるのはオーナー（Web UI かチャネル）だけ。
- board の `InteractionResponder.answer` に答えの出どころ（`BotAnswerOrigin`）を渡すようにした。承認した人は **Web UI か、どのチャネルか** までで、チャネルの中の人は記録しない（`BotChannelLink.answer` は人を取らない。docs/specs/bot-discord-home.md §9 のとおり、承認を押せるのはチャネルがオーナーと照らした人だけ）。
- §8 の「承認待ちは失敗ではない」の行は、コネクターの操作と設定の変更をまとめた 1 行にした。

**誰の依頼か（§4）**

- `host/settings/authority.ts`。Main と Web セッションのターンごとに、`turn/start` の後の最初の「人かお知らせ」の入力で、始めた人を決める。オーナーは source が `user` で principal が無く、見出しが無いか見出しに `owner` があるもの。オーナー以外は、見出しにオーナーの印が無い発言と、bot-core のお知らせ（`bot-connector`、`bot-schedule`、`bot-connector-event`、`bot-file`、`bot-session`、`bot-main`、`bot-main-relay`）。runtime context など、ほかの入力は数えない。
- ターンが bot-core の見ていないところで始まっていたら（再起動の直後など）、`change` は「次のターンで」と断る。
- ターンを始めたのがオーナーでも、その後にオーナー以外の入力が入ったら `free` も承認にする。
- 出すのは Main と Web セッション（と、その振り返り。振り返りでは guard が `skill_manage` 以外を断る。宣言をそろえるため）。スケジュールの単独実行、サブエージェント、Main が始めたセッション（`delegated`）、整理のセッションには出さない。

**目録（§2）**

- 契約は `src/settings-contract.ts`（`BotSettingsArea`）と `src/shared/settings.ts`。`entries` は `signal` を取る（チャネルの候補は Discord に聞くため）。
- 区画に `implied(botId, changes)` を足した: その変更で一緒に変わるほかの項目（チャネルの `clears` で空になるオーナーなど）。承認のカードにはそれも「前 → 後」で出す。
- 履歴には頼まれた値ではなく、適用の前後に区画から読み直した値の差を記録する（名前の前後の空白、タイムゾーンの正規化、`clears` で空になった項目も入る）。`Bot.registerSettingsArea(area)` と `settingsAreas()` を足した。
- 値は `{ raw, shown }`。`raw` は `change` に渡す形（文字列、数、真偽、文字列のリスト。秘密は設定済みかどうかの真偽）、`shown` は人が読む名前（`{ en, ja? }`）。
- 受け付ける形は `toggle`、`integer`、`text`（`known`: 今わかる値と名前）、`choice`、`list`。チャネルの `pick` と `source` 付きの `list` は `choice` ではなく `text`（`known` に候補）にした。オーナーの候補はホームで変わるので、ホームとオーナーを一度に変えるとき、今のホームの候補で弾かないため。検査は保存の道の `check` が行う。
- 変更の決まりに `directional` を足した（強くする方向は `free`、緩める方向は `approve`）。コネクターのツールの許可は `tool.<ツール名>`、値は `default`、`allow`、`ask`、`disallow`。`default` はそのツールの既定と同じ強さとして比べる。アカウントごとの許可は区画に入れていない。
- チャネルとコネクターの項目の `agent` は必須で、登録のときに検査する（note は英語で 400 字まで。秘密は `{ note }` だけで、`change` を書くと拒否）。
- 区画の並び: `general`、`models`、`channels.<id>`、`connectors.<id>`、`skills`、`logins`、`environment`、`workspaces`、`mains`、`web`、ほかのプラグインの区画。
- モデルは `profile-default`、`<provider>/<model>`、`<provider>/<model>@<effort>` のトークンで選ぶ（推論の強さを別の項目にしない）。
- チャネルの区画: オン・オフ（`enabled`、approve）と各項目。`pick` が変わったときの `clears` は Web UI と同じ（同じ変更でその項目も渡せば空にしない。`channelValuesAfter` を shared に移し、Web UI もこれを使う）。秘密は変えられない。
- スキルの区画に、表に無い「スキルの整理」（`skillCurator`）も free で入れた（振り返りと同じ種類の設定のため）。
- ログイン、VM、ワークスペース、Main の入れ替え、Web lookup は読むだけの区画。

**ツール（§6）**

- 説明とテキストは `host/settings/texts.ts`、動きは `host/settings/tool.ts`、書式は `host/settings/describe.ts`。`describe` の 1 項目は `<区画> / <キー> — "名前"（Web UI: 場所）`、Web UI の説明、`For you:`、`Now:`（名前と値）、受け付ける形、`Change:` の順。
- `reason` は必須（500 字まで）。今と同じ値の項目は変えない。`never` の項目は Web UI の場所を添えて断る。
- 同じボットの適用は 1 つずつ行う。

**履歴と取り消し（§7）**

- 保存の domain `dsh_bot_settings`（版 1）、表 `changes`。ボットごとに新しい 200 件まで。書き込みは `host/settings/store.ts` だけ（設計ルール 76 を足した）。ボットを消したら消す。
- Remote `botSettings`（`watch`、`revert`）。ボットの設定の **ボットが変えた設定**（order 450）。各行に時刻、承認（Web UI / チャネル名）、理由、項目ごとの「前 → 後」。**元に戻す** は、その後の記録が同じ項目を変えていない、かつ今の値が変更の後の値のままのときだけ出す。そうでなければ「その後に変わったため戻せません」。取り消しは記録を「元に戻した」にする（新しい記録は作らない）。

**プロンプト（§8）**

- `bot:environment` を Main と Web セッションでは `bot_settings` の案内に替えた。ほかのセッション（`bot_settings` が無い）では「このセッションからは読めず変えられない。どの設定を変えるかをオーナーに伝える」にした。docs/specs/bot-system-prompt.md の該当の行はこれで置き換わる。

**行と設計ルール**

- 行 `env-bot-core-settings`（`@1outres/dsh-bot-core/settings`、`src/plugins/settings.ts`、conversations 行の後）。exports は `./settings`。行を足したので、既にいるボットの preset の版は更新の後に一度変わる。
- 設計ルール 34 の例外に `plugins/settings.ts` を足し、76（`settingChanges` への書き込みは `host/settings/store.ts` だけ）を足した。

**確かめていないこと**

- 動作確認用の DSH でボットを作るには VM host が要り、この作業では立てていない。承認のカード（Web UI と Discord）と「ボットが変えた設定」の画面は、テスト（`test/bot-settings.test.ts` ほか）でしか確かめていない。
