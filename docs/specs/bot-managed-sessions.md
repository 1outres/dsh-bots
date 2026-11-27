# ボットの managed sessions（Main が操作するセッション）仕様

状態: `feat/bot-managed-sessions` で実装。DSH のワークスペースを作り先にする拡張（§10）は `feat/bot-workspace-sessions` で実装。

## 1. 目的

- ボットの Main セッションが、ボットの**普通のセッション**（`Bot.createSession` で作られ、ボットのセッション一覧に普通に出るもの）を作り、メッセージを送り、結果を読む。
  DSH のサブエージェント（`@deepseek-ai/dsh-tool-subagent`）は使わない: 子はボットの一覧に出る普通のセッションで、オーナーも Web UI で開いて読み書きできる。
- 操作は 1 組のツールで、作り先（target）を引数で分ける。`bot`（ボット自身の環境 = VM、ボットのプリセット）と
  `workspace`（オーナーが許可した DSH の普通のワークスペース。ボットを特定プロジェクトのオーケストレーターにする。§10）。
- オーナーが自分で作ったボットのセッションも、オーナーが明示的に許可したものだけ Main に任せられる（引き継ぎ）。

## 2. 用語と契約（`src/shared/managed-sessions.ts`）

```ts
/** 作り先: ボット自身の環境、またはオーナーが許可した DSH のワークスペース（§10）。 */
type BotManagedTarget =
  | { readonly kind: "bot" }
  | { readonly kind: "workspace"; readonly workspaceId: string }

/** 子の質問（ask_user_question）と plan review に誰が答えるか。 */
type BotManagedAnswerer = "main" | "owner"

/** 管理が始まった経緯: Main が session_start で作った / オーナーが任せた。 */
type BotManagedOrigin = "main" | "owner"

interface BotManagedSession {
  readonly botId: string
  readonly sessionId: string
  readonly target: BotManagedTarget
  readonly answerer: BotManagedAnswerer
  readonly origin: BotManagedOrigin
  /** session_start の title。オーナーが任せたセッションには無い。 */
  readonly label?: string
  /** 管理が始まった時刻。 */
  readonly since: number
}
```

- **回答者の既定値**（`DEFAULT_ANSWERER`、target の種類ごと）: `bot` → `main`、`workspace` → `owner`。
  session_start で省略したとき、オーナーが任せたときに使う（既定値であって fallback ではない。値は必ず記録される）。
- 依頼文では回答者を "bot" / "user" と呼んでいた。コード上は bot-core の他の語（Main、owner）に揃えて `main` / `owner` にした。

### `botManagedSessions` Remote（`shared/managed-sessions.ts`、`shared/remote-contract.ts`）

| メソッド                                  | 意味                                                                                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `watch()`（stream）                       | `{ sessions: BotManagedSession[] }`（全ボット、since の古い順）。変わるたびにもう一度                                                                                                         |
| `entrust(botId, sessionId)`               | オーナーがセッションを Main に任せる（origin `owner`、回答者は target の既定値）。ボットのセッションなら target `bot`、許可されたワークスペースのセッションなら `workspace`。管理の記録を返す |
| `release(botId, sessionId)`               | 任せるのをやめる。Main には notice で伝える                                                                                                                                                   |
| `setAnswerer(botId, sessionId, answerer)` | 回答者を変える（オーナーだけが変えられる。Main は session_start のときだけ選ぶ）                                                                                                              |

Remote の呼び出し元は DSH のオーナー（Web UI）。任せること・回答者を変えることは Remote にしかなく、Main のツールからはできない（「ユーザの明示的な許可」）。
入力は信用しない（`parseAnswerer` など）。拒否は Error（メッセージをそのまま見せる）。

## 3. 保存（`host/managed/`）

- ストレージドメイン `dsh_bot_managed_sessions`（version 2、`compatibleVersions: [1]`、`invalidRecords: "backup-and-skip"`）、テーブル `sessions`、キーはセッション ID。
  値は `{ botId, target, answerer, origin, label?, since }`。書くのは `host/managed/store.ts` だけ（設計ルール 53）。スキーマはルール 27 のスナップショット対象。
  version 2 で `target` に `workspace` を足し、テーブル `workspaces`（ワークスペースの許可、§10.1。書くのは `host/managed/grants-store.ts` だけ、設計ルール 56）を足した。version 1 の記録はそのまま version 2 として読める。
- ボットを消すと行も消える（`forgetDeleted` の purge）。
- **起動元の印**（`dsh_bots` の `sessions` の `startedBy?: "main"`）: Main が session_start で作ったセッションの所属の記録に、作成時（最初のターンより前）に書く。
  省略できる項目の追加なので `dsh_bots` は version 2 のまま（互換）。管理をやめても消えない（セッションの種類 §8 がこれで決まり、途中で変わらないため）。

## 4. 管理できるセッション

target ごとに規則がある（`ManagedSessions.targetOf`）。`workspace` の規則は §10.3。

target `bot`: 管理の対象（session_start で作る / 任せる）になれるのは、そのボットの `sessions` に記録されたセッションで、次のどれでもないもの:

- ボットの Main セッション
- 過去の Main（`docs/specs/bot-main-rotation.md` で新しい Main に替わったもの。所属の記録に `retiredMain` がある）
- スケジュールの separate 実行のセッション（実行中、または run の記録にあるもの）
- サブエージェント（そもそも `sessions` に記録されない）
- アーカイブ済みのセッション

Main のツールが操作できるのは、そのボットで管理中のセッションだけ（他のボットのもの、管理していないものは拒否）。

**管理が終わるとき**: オーナーが「任せるのをやめる」、Main が `session_release`、オーナーがセッションをアーカイブ、ボットの削除。
target `workspace` ではさらに、ワークスペースの許可の削除と、ワークスペースが DSH から消えたとき（§10.10）。
Main 自身の `session_release` と削除以外は Main に notice（kind `released`）で伝える。

## 5. ツール（Main セッション専用）

行 `env-bot-core-sessions`（`@1outres/dsh-bot-core/sessions`、`src/plugins/sessions.ts`）。compose.ts が他の bot-core の行と同じく全ボットのグループに置き、テンプレートや overlay は名前を使えない。
dsh-tools の `register(definition, { when })` で **Main セッションの Agent だけに見せる**。届いた呼び出しも bot-core で確かめ、Main 以外（Web セッション、管理中の子、スケジュール、サブエージェント）には
「Main セッションでしか使えない」旨のエラーを返す（schedule・stay_silent と同じ `mainSessionRefusal`）。

| ツール            | 引数                                                                                           | 結果                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `session_start`   | `target`（`"bot"` か `"workspace:<id>"`、必須）, `title`, `instruction`, `model?`, `answerer?` | 作ったセッションの ID と記録。`instruction` が最初のメッセージとして届き、ターンが始まる                                     |
| `session_send`    | `session_id`, `message`, `mode?`（`queue` 既定 / `steer`）                                     | 受け付けた旨                                                                                                                 |
| `session_read`    | `session_id`, `after?`（前回の `cursor`）, `limit?`（既定 10、最大 50）                        | 状態、答えを待っている質問、`after` より後の発言（古い順、末尾 `limit` 件）と `cursor`                                       |
| `session_answer`  | `session_id`, `interaction_id`, 質問なら `answers`、plan review なら `approved` と `feedback?` | 受け付けた旨（回答者が `main` のときだけ）                                                                                   |
| `session_stop`    | `session_id`                                                                                   | 走っているターンを止める（Web UI の停止と同じ `session.cancel`）                                                             |
| `session_list`    | —                                                                                              | 管理中のセッション（ID、label、ワークスペース、origin、回答者、状態）、許可されたワークスペース（§10.1）と選べるモデル（§6） |
| `session_release` | `session_id`, `archive?`                                                                       | 管理をやめる。`archive: true` ならアーカイブ（走っている作業も止まる）                                                       |

- **Main からのメッセージ**（`instruction`、`session_send`）は user ロールのメッセージで、source `{ kind: "bot-main-relay", form: "relay" }`、本文の先頭に
  `Your Main session sent a message:` を付ける（DSH の `send_message` の relay と同じ形）。オーナーが Web UI で書いたもの（source `user`）と区別できる。
  `queue` は `followup`（走っていればその後の自分のターン、止まっていれば起こす）、`steer` は走っているターンの次のステップに `inject`（止まっていれば `followup`）。
- **`session_read`** はセッションの Agent を読み込み（必要なら resume）、`deriveMessages()` から作る。各発言は
  `owner`（source `user`）/ `main`（`bot-main-relay`）/ `notice`（他の source。summary だけ）/ `assistant`（テキストと、呼んだツールの名前）。ツールの結果は出さない。
  1 件は 2000 文字で切る。状態は `running` / `idle` / `waiting`（答えを待つ質問がある）。
- **`session_answer`** は bot-core の interaction board（`host/interactions/board.ts`）に、答えた者 `{ via: "main" }` として渡す（形の検査は Web UI・チャネルと同じ `interactionAnswerProblem`）。
- `session_stop` で止めたターンの終わり（cancelled）は Main に知らせない（自分で止めたので）。この記録はメモリだけ（再起動で消えるが、止めたターンは再起動で残らない）。

## 6. モデル

- `Bot.createSession(botId, { title?, model? })` に `model?: BotSessionModelRequest` を足した。

```ts
type BotSessionModelRequest =
  | { readonly role: "main" }
  | { readonly role: "delegate"; readonly choice: BotModelChoice }
```

- 省略は `{ role: "main" }`（今までと同じ。New session、schedule の separate 実行、Main）。
- `delegate` はボットの `delegates` に同じ選択（`sameModelChoice`）があるときだけ使え、無ければ `BotSessionModelRefusal`（`host/models/models.ts`）でセッションを作らない。`shared/models.ts`（並行作業のモデル設定画面と共有）のエラーコードは増やさない。
  使えるかは `main` と同じく DSH の登録で確かめる（`docs/specs/bot-models.md` §6）。`profile-default` が delegates にあれば選べる。
- **ツールでの指定**: `session_start` の `model` は文字列の ID。省略 = `main` 役割。指定するなら `session_list` の `models` に出る delegates の ID だけ
  （`profile-default`、`<provider>/<model>`、effort 付きは `<provider>/<model>@<effort>`）。delegates が空なら指定はすべて拒否する（エラー文で「オーナーが設定で delegates を足す」ことを伝える）。
  main 役割を ID で指定する口は作らない（省略がそれ）。
- 作ったセッションのモデルはその後の設定変更に従わない（`bot-models.md` §5 の Main 以外と同じ）。

## 7. Main への通知

- notice の topic `session`（source `bot-session`）を足した。`dsh_bot_notices` は version 5（1–4 と互換）。配信タイミングは `next-turn`（schedule と同じ）:
  Main が別のターン中ならそのターンの後に自分のターンとして処理される。子の結果は Main が待っているものではなく自分の仕事で、
  混ぜると stay_silent がユーザへの返答まで止めてしまうため。
- いつ送るか（管理中のセッションについてだけ）:
  - ターンが**生きて**終わったとき（`turn/end` の completed / failed / cancelled。`endedTurnOf`）。誰が始めたターンでも送る
    （オーナーが任せたセッションでオーナーが直接書いた分も、Main が追えるように）。Main の `session_stop` で止めたものは送らない。
  - 質問または plan review が開いたとき（interaction board に開いたとき）。回答者が `owner` でも送る（Main は待っていることを知る。答えはしない）。
  - 管理が終わったとき（オーナーの「任せるのをやめる」、アーカイブ）。
- 文面は短く、中身は session_read で読む:

```
[session] "<label>" (<id>) — turn completed. Read it with session_read.
[session] (<id>) — turn failed: <理由>. Read it with session_read.
[session] "<label>" (<id>) — turn cancelled.
[session] "<label>" (<id>) — waiting for an answer to a question; you answer it with session_answer (see session_read).
[session] "<label>" (<id>) — waiting for a plan review; your owner answers it in the Web UI.
[session] "<label>" (<id>) — your owner took this session back; you no longer manage it.
[session] "<label>" (<id>) — archived by your owner; you no longer manage it.
```

ワークスペースのセッション（§10）は括弧にワークスペースを足し、次の文面も使う:

```
[session] "<label>" (<id>, Workspace <workspaceId>) — waiting for an approval; your owner answers it in the Web UI.
[session] "<label>" (<id>, Workspace <workspaceId>) — your owner withdrew your access to its Workspace; you no longer manage it.
[session] "<label>" (<id>, Workspace <workspaceId>) — its Workspace was removed from DSH; you no longer manage it.
```

label の無いセッションは `"<label>" ` を省く。summary（UI の 1 行）は 1 行目の `[session]` 以降。

- 承認依頼: ボットのセッションは承認ポリシー `never`（`BOT_PERMISSION`）なので DSH の承認依頼は来ない。interaction board に approval が開いても
  通知・回答の対象にせず、`session_answer` は approval を拒否する（オーナーが Web UI で答える）。
- 再起動: 管理の記録は保存されている。通知は生きているイベントからだけ作るので、Host が止まっていた間に終わったターンや、
  再起動で interrupted になったターンは通知されない。Main は `session_list` / `session_read` で状態を読む。

## 8. 回答者

- `main`: 子の質問・plan review が開くと Main に notice（§7）。Main は session_read で質問と選択肢を読み、session_answer で答える。
  **オーナーも Web UI のカードでいつでも答えられる**（最初の答えが勝つ。オーナーは Main より上の立場で、Web UI から見ている人が答えられないことにはしない）。
  閉じたカードには「Main が答えた」と出る。
- `owner`: 今どおり bot-core のカード（Web UI）でオーナーが答える。Main には「待っている」ことだけ notice で伝え、session_answer は拒否する。
  管理中の子は Main セッションではないので、質問はチャネル（Discord）には出ない（今の Web セッションと同じ。§11）。
- 回答者は session_start で Main が選ぶ（省略は既定値 §2）。以後はオーナーだけがセッションのメニューで変えられる。
- 時間制限付きの質問（`askTimed`）は今どおり数える。回答者が答えないまま期限が来れば子は先へ進む。
- `BotAnswerOrigin` に `{ via: "main" }` を足した。Web UI の閉じたカード（`ask.closed.main`）、Discord の描画（Main の interaction しか届かないので
  来ないが、型として「Main が答えた」）を足した。

## 9. プロンプト

- **Main**: セクション `bot:managed-sessions`（order 4150、セッションの種類が `main` のときだけ）。

```text
## Sessions you manage
Keep your Main session for the conversation itself. Hand any task that is large or may need trial and error (writing or changing code, debugging, installing or configuring software, research across many sources, anything likely to take more than a few tool calls) to a session of your own with session_start instead of doing it here: a long turn here keeps new messages and notices waiting, and everything you write along the way reaches your chat channels. Do quick things here directly, such as answering from what you know, a single lookup, or reading or editing one file.
You can run work in sessions of your own with the session_* tools: session_start opens one (target "bot": your own machine and setup) with an instruction that must stand on its own, and you follow it with session_read, session_send and session_answer. Your owner may also hand you one of their sessions to manage. Each ended turn and each question there reaches you as a [session] notice; read the session before you report, and tell your owner only what matters. Your owner sees these sessions in the Web UI and may write or answer in them too. Release a session when its work is done.
```

- **Main が作ったセッション**: セッションの種類 `delegated` を足した（`startedBy: "main"` の記録、§3）。種類は作成時に決まり、管理をやめても変わらない（§1.1 の規則）。
  セクション §2.4 の文面:

```text
## This session
This session was started by your Main session for a task. Messages from your Main session start with "Your Main session sent a message:"; your owner may also read and write here in the Web UI. Your replies are read by your Main session and do not reach your chat channels, and stay_silent does not work here. Finish the task in your turn and end with a reply that says what you found or did.
```

`bot:messages` と `bot:status` は入れない（チャネルの話をしない）。`bot:workspace-files` と `bot:memory` は入れる。

- **管理中であること**: コンテキスト `bot:management`（order 320）。今管理されているセッション（作られたものも任されたものも）にだけ入り、管理が終われば消える。
  オーナーが任せたセッション（種類は `web` のまま）にセクションで伝えると、引き継ぎでシステムプロンプトが変わってしまうので、毎回組み立て直すコンテキストにした。

```text
Session management:
- Your Main session manages this session: it sends you work and reads your replies. Messages from it start with "Your Main session sent a message:".
- Questions you ask with ask_user_question are answered by your Main session (your owner may answer them in the Web UI too).
```

回答者が `owner` なら 2 行目は `- Questions you ask with ask_user_question are answered by your owner in the Web UI.`。

- 文面の原文は `host/prompt/texts.ts`、選び方は `host/prompt/sections.ts`。`test/prompt-scope.test.ts` のスナップショットに Main と delegated と管理中の Web を足した。

## 10. DSH のワークスペースを作り先にする（target `workspace`）

ボットの Main が、DSH の普通のワークスペース（Host のディレクトリ）のセッションを作り、送り、読み、答え、止める。ボットはそのプロジェクトのオーケストレーターになる。
ツール・管理の記録・通知・Remote は §2–§8 と同じものを target で分けて使う。

### 10.1 許可（`shared/workspaces.ts`、`host/managed/grants.ts`）

- 使えるのは **オーナーがボットごとに許可したワークスペースだけ**。許可は `BotWorkspaceGrant`:

```ts
interface BotWorkspaceSettings {
  readonly agentPreset: string // DSH の Agent プリセット（ボットのものは不可）
  readonly permission: PermissionBundle // { sandbox, approval }
  readonly model: BotModelChoice // session_start が model を省いたときのモデル（profile-default = DSH の既定）
}
interface BotWorkspaceGrant extends BotWorkspaceSettings {
  botId
  workspaceId
  since
}
```

- 保存は `dsh_bot_managed_sessions` の `workspaces` テーブル（キー `<botId>/<workspaceId>`）。
- プリセットと権限は許可するときに決め、Main は選び直せない（ツールに引数が無い）。変更はオーナーだけ（設定 UI、即時保存）で、作ったあとのセッションには及ばない。
- 選べるもの（`options()`、`host/managed/options.ts`）:
  - プリセット: `agentPresets.list()` のうち、ボットのプリセット（`bot-` 接頭辞）と読み込みに失敗しているものを除いたもの。
  - 権限: dsh-permission-presets の設定済みプリセット（`auto` は現在のセッション専用なので除く）。保存するのは束（sandbox と approval）で、セッションに設定するときにその束を持つプリセットを選ぶ（`presetOfBundle`。無ければ作成を拒否）。dsh-permission-presets が無い DSH では 6 通りの組み合わせ（knob をそれぞれの setter で書く。ボットの権限と同じ `host/permission.ts`）。
  - モデル: `profile-default` か DSH の登録で使える固定ルート（`bots.resolve` で確かめる）。
- 許可するとき・変えるときに、プリセット・権限が選べるものに含まれるか、モデルが使えるかを確かめる（含まれなければ拒否。置き換えない）。
- `botWorkspaces` Remote（`shared/workspaces.ts`）: `watch()`（全ボットの許可と DSH のワークスペース一覧）、`options()`、`grant(botId, workspaceId, settings)`、`configure(botId, workspaceId, change)`、`revoke(botId, workspaceId)`。呼び出し元は DSH のオーナー。入力は信用しない（`parseWorkspaceSettings`）。
- Main には `session_list` で許可されたワークスペース（`workspace:<id>`、名前、パス、プリセット、権限、モデル）を見せる。

### 10.2 作り方（`host/managed/workspace-session.ts`）

1. モデルを決める（§10.5）。DSH が使えないモデルなら何も作らない。
2. `sessionController.create({ workspaceId, agentPreset })`（DSH の New session と同じ。Host のディレクトリで動き、ワークスペースの一覧に普通に出る）。
3. 返ってきたプリセットが許可のものと違えば、そのセッションをアーカイブして失敗にする。
4. 許可の権限を記録する（`permissions.apply`。dsh-permission-presets が既定を記録した後に書く）。
5. 固定モデルなら `agent.model.select`（`sessionController.selectModel` は使わない。あれはプロファイルの既定も書き換える）。
6. タイトル（`session.rename`、失敗は警告だけ）。管理の記録（origin `main`）を書いてから、instruction を relay で送る。

ボットのセッションとしては**記録しない**（`dsh_bots` の `sessions` に入れない。`registry.adopt` しない）。

### 10.3 管理できるワークスペースのセッション

- ボットのセッション（どのボットのものでも）でなく、DSH のワークスペースのメンバー（`workspaceRegistry` の `sessionIds`）で、そのワークスペースがそのボットに許可されており、アーカイブされていないもの。
- 1 つのセッションを管理するボットは 1 つ（記録のキーはセッション ID）。
- オーナーが任せたセッションは、そのセッションのプリセット・権限・モデルのまま（オーナーが自分のセッションを明示的に渡したので、許可の設定で上書きしない。決定事項）。

### 10.4 isolation の境界

- ワークスペースのセッションは DSH の標準プリセット（ボットのでないもの）で、記録もされないので、bot-core の判定（`createSessionIdentity`）では `none`。
  したがって isolation の guard/mask、`BOT_PERMISSION` の固定、working-directory の環境 fs、bot-core のプロンプト行（ボットのグループの中にしかない。設計ルール 37）、placement はどれも及ばない。
- 逆に、ワークスペースのセッションからボットの VM・ボットのツール（session_*、notes、connectors…）は届かない（それらはボットのプリセットのグループの中にしか無い）。
- オーナーが DSH の UI で空のワークスペースのセッションをボットのプリセットに切り替えた場合は今までどおり lockdown（ボットのでないセッションがボットのプリセット）。
- テスト: `test/workspace-sessions.test.ts`（選べるプリセットにボットのものが無い、作成で記録しない、identity が `none`）、`test/preset-isolation.test.ts`（Workspace の Agent には mask も guard も付かない）。

### 10.5 モデル

- `session_start` で `model` を**省いたら許可の `model`**（`profile-default` なら DSH の既定。DSH の普通のセッションと同じく、記録せずに既定に従う）。
- **指定できるのはボットの delegates だけ**（target `bot` と同じ ID。§6）。ボットの main 役割は使わない（ワークスペースの仕事のモデルはオーナーが許可で決める）。
- どちらもここで DSH が使えるか確かめ、使えなければセッションを作らない（別のモデルで作らない）。

### 10.6 回答者と承認

- 回答者の既定は `owner`。`session_start` で `main` も選べ、以後はオーナーがメニューで切り替える。
- `owner`: 質問・plan review は DSH の通常の UI がそのまま受ける（bot-core は waterfall で `next()` に渡し、待っている間だけ記録する。`host/managed/waits.ts`）。Main には「待っている」ことを通知し、`session_read` に「オーナーを待っているもの」（種類と要約）を出す。`session_answer` は拒否。
- `main`: 質問・plan review は bot-core が引き受け、interaction board に置く（ボットのセッションと同じ）。Main は `session_answer` で答え、オーナーもそのセッションを開けば bot-core のカードで答えられる（最初の答えが勝つ）。
- **承認依頼（approval）は常にオーナー**: 権限モード（approval `ask`）次第で来る。bot-core は引き受けず DSH の通常の承認 UI に渡し、Main には待っていることを通知する。Main は答えられない。
- 切り替えは、その後に開く質問から効く（開いているものは開いた場所に残る）。

### 10.7 Main からのメッセージ

- source は同じ `{ kind: "bot-main-relay", form: "relay" }`。先頭の行はワークスペースのセッション用: `Bot "<name>", which your owner lets manage this session, sent a message:`（ボットの名前はヘッダと同じ規則で 1 行に。`host/managed/messages.ts`）。
- ワークスペースのセッションに「BOT の Main から操作されている」コンテキストは**入れない**: bot-core のプロンプト機構はボットのグループの中にしか無く（ルール 37）、ワークスペースのセッションに入れるには DSH の Agent に bot-core が文章を書き込む（`agent.inject` 等で他人のセッションのログに残す）しかない。relay の先頭行で足りる。

### 10.8 誰の発言から操作できるか（`host/managed/authority.ts`）

Main はチャネル経由で owners 以外（Discord の allowed users）からも話しかけられ、コネクタのイベント（外部のメールなど）も notice で届く。ワークスペースは Host のディレクトリなので、第三者がそれを操作させられないようにする:

- Main の**今のターンに入った入力がすべてオーナー側のもの**のときだけ、workspace target の操作（`session_start` の workspace、ワークスペースのセッションへの `send` / `read` / `answer` / `stop` / `release`）を許す。
- オーナー側: Web UI の発言（`principal` の無い `user`）、チャネルでヘッダが `owner` を示す発言、bot-core 自身の notice（session、schedule、notes など）、質問への答え。
- オーナー側でない: ヘッダに `owner` の無いチャネルの発言、`principal` のある（オーナー以外の DSH peer の）発言、`bot-connector-event`（コネクタのイベント）。
- そうでない入力がターンに入ったら、そのターンが終わるまで拒否する（エラー文で、オーナーが直接頼めることを伝える）。`session_list` はワークスペースの行を出さず、その理由を 1 行で出す。
- bot-core がターンの始まりを見ていない（ターンの途中で読み込まれた）ときも拒否する（fail closed）。記録はメモリだけ。
- target `bot` の操作はこれまでどおり制限しない（ボット自身の環境の中のことなので）。
- 残るリスク: ターンの中でツールが読んだもの（Web のページ、ファイル）による誘導はこの規則の外（既知の制限として受け入れる。決定事項）。

### 10.9 引き継ぎと Web UI

- DSH のワークスペースのセッション行のメニュー（`ctx.contextMenus` の target `session`、order 550、アーカイブの前に区切り）:
  - 管理していない・アーカイブされていないセッションで、そのワークスペースを許可したボットがいるとき: 「BOT に任せる」→ サブメニューでボットを選ぶ（`entrust`）。
  - 管理中: 「質問は自分で答える」/「質問は <bot> が答える」（今と逆の方）、「<bot> に任せるのをやめる」。
- 管理中の印: DSH の `sidebar.session.row.trailing` に小さなアイコン（ボットの行の印と同じ `dshb-managed-mark`、ツールチップ「<bot> が管理中」）。
- 管理中のワークスペースのセッションを開くと、bot-core が引き受けた質問（回答者 `main`）のカードが composer の席に出る。
- ボットの設定に「ワークスペース」節（`client/settings/WorkspacesSection.tsx`、order 185、Models の次）: 許可したワークスペースごとに group（タイトルはワークスペース名）で、「フォルダ」（パス）、「エージェントプリセット」「権限」（`Select`）、「モデル」（Models と同じ `ModelRoute`）、「削除」（赤い行ボタン）。最後に「ワークスペースを追加」の行（未許可のワークスペースを選び ✓ で許可。初期値は DSH の既定のプリセット・既定の権限プリセット・DSH の既定モデル）。すべて即時保存、説明文なし、拒否は行の `danger` meta。
- i18n は en / ja。

### 10.10 消えたとき

- **許可を消した**: そのボットのそのワークスペースのセッションの管理が終わり、Main に通知（`revoked`）。セッションはオーナーの DSH のセッションとして残り、走っているターンは止めない（オーナーが DSH の UI で止められる。決定事項）。
- **ワークスペースが DSH から消えた**（`domain/changed` の `workspace`、および起動時に確かめる）: そのワークスペースの許可を全ボット分消し、管理を終えて Main に通知（`workspace-removed`）。同じディレクトリを足し直すと別のワークスペースになるので、許可は付け直す。
- **ボットを削除**: 許可と管理の記録を消す（通知なし）。ワークスペースのセッションは残し、アーカイブも停止もしない（オーナーのもの）。
- **セッションのアーカイブ**: target `bot` と同じ（管理が終わり、Main に通知）。

### 10.11 実装の場所

| 何                                  | どこ                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 許可の型、Remote の契約、入力の検査 | `src/shared/workspaces.ts`                                                                                                   |
| 許可の保存（ルール 56）             | `src/host/managed/grants-store.ts`                                                                                           |
| 許可の規則                          | `src/host/managed/grants.ts`、選べるもの `src/host/managed/options.ts`、Remote の入口 `src/host/managed/workspaces-panel.ts` |
| セッションの作成                    | `src/host/managed/workspace-session.ts`（`sessionController.create` は index.ts から注入。ルール 1）                         |
| 発言者による制限                    | `src/host/managed/authority.ts`                                                                                              |
| DSH の UI が持つ待ち                | `src/host/managed/waits.ts`                                                                                                  |
| ブラウザ                            | `client/workspaces.ts`（状態）、`client/workspace-sessions.ts`（メニューと印）、`client/settings/WorkspacesSection.tsx`      |

## 11. 既存の機能との関係

- **schedule の separate 実行**: `Bot.createSession`（main 役割）で作り、ランナー（`host/schedule/runner.ts`）が持つ。管理の対象にはならず（§4）、
  session_list にも出ない。1 ターンで `schedule_result` を返し、終わればアーカイブされる。managed sessions は Main が会話のように続けて操作するもので、
  時刻で起動するものではない。将来 separate の実行に delegates のモデルを選ばせるなら、この `BotSessionModelRequest` を使う。
- **Web セッション（New session、フォーク）**: 今までどおり種類 `web`。オーナーが任せると管理中になり、コンテキスト `bot:management` が入る。
- **サブエージェント**: DSH の規則のまま。管理中の子が作るサブエージェントは子に結果を返す。
- **チャネル**: 管理中の子の質問はチャネルに出ない。オーナーがスマートフォンで答えたい使い方は、将来チャネルの contract にセッションを示す口を足して扱う（未解決）。
- **オーナーが任せたときの通知**: Main には送らない（決定事項）。Main のターンを使うほどのことではなく、Main は session_list で知る。通知は任せるのをやめたとき・アーカイブしたときだけ（§7）。
- **待つあいだ Main が黙ること**: セッションに仕事を任せたターンで Main が stay_silent を呼び、結果を報告できるまで黙るのは正しい対応の一つとして許す（決定事項）。

## 12. Web UI

ワークスペースのセッションのメニュー、印、ワークスペース節は §10.9。

`docs/specs/ui-design.md` に従う。

- **セッションのメニュー**（`client/session-menu.ts`、Main 以外のボットのセッション）: 管理していないアーカイブされていないセッションに「Main に任せる」。
  管理中のセッションには「質問は自分で答える」/「質問は Main が答える」（今と逆の方）と「Main に任せるのをやめる」。アーカイブとの間に区切り。
- **セッション一覧**: 管理中のセッションの行のタイトルの後ろに控えめな印（小さなアイコン、tertiary の色、ツールチップ「Main が管理中」）。
  走っている点（`dshb-dot`）とホバーのボタンはそのまま。
- 失敗（任せられないセッション、切断）は既存のトーストで出す。
- i18n は en / ja。

## 13. 実装の場所

| 何                                       | どこ                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| 型、Remote の契約、入力の検査            | `src/shared/managed-sessions.ts`                                                           |
| 保存（ルール 52）                        | `src/host/managed/domain.ts`、`src/host/managed/store.ts`                                  |
| 管理の規則（任せる・やめる・回答者）     | `src/host/managed/sessions.ts`                                                             |
| ツールの仕事                             | `src/host/managed/tools.ts`、発言の整形 `src/host/managed/transcript.ts`                   |
| モデルの ID                              | `src/host/managed/models.ts`                                                               |
| 通知の文面と、イベントから通知を作るもの | `src/host/managed/notice.ts`、`src/host/managed/follow.ts`                                 |
| ツールの行                               | `src/plugins/sessions.ts`                                                                  |
| Remote                                   | `src/host/remote.ts` の `BotManagedSessionsRemoteService`                                  |
| ブラウザ                                 | `client/managed-sessions.ts`（状態）、`client/session-menu.ts`、`client/BotSessionRow.tsx` |
| ワークスペース（§10）                    | §10.11                                                                                     |

## 14. 実装で確定したこと

- **起動元の印の書き込み**: DSH は `agents.create` の中で `agent/created` を出し、bot-core のその listener はフォークを拾うためにボットのプリセットのセッションを記録する。
  そこで先に記録されると `startedBy` が書けない。`Bot.createSession` が作っている最中のセッション ID（`createAgent` が自分で決める）を覚え、その listener はそれを記録しない（記録は `Bot.createSession` が印つきで行う）。
- **ピン留めノート**: 種類 `delegated` にも `bot:pinned-notes` を入れ、オーナーの発言が名指すノートの notice も付ける（Web セッションと同じ）。子は Main の代わりに仕事をするのでノートを読む。
- **セッションのメニュー**: 管理の項目（任せる / 回答者 / やめる）を先に、アーカイブ（またはアーカイブ解除）を区切りの後に置く。アーカイブ済みのセッションに「任せる」は出さない。
- **失敗の表示**: 任せる・やめる・回答者の変更が断られたら、ボットの行のエラー（アーカイブの失敗と同じ `status`）に出す。
- **Remote の名前空間**: `botManagedSessions`（`bots` に足さず、専用の面にした。ブラウザは 1 本の `watch` で全ボット分を受け、行の印とメニューに使う）。
- **source の名前**: Main からのメッセージの source は `bot-main-relay`（main-rotation が Main のメンテナンスのターンに `bot-main` を使うため）。
- **過去の Main**: 管理の対象にしない（§4）。メニューにも管理の項目を出さない。
- **Main に任せない作業（2026-11-27）**: 大きい作業や試行錯誤が要る作業は Main でせず session_start で任せる、という段落を `## Sessions you manage` の冒頭に足した。
