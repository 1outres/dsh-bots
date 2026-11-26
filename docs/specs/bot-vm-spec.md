# ボットの VM スペック

決まったこと（2026-11-24、`feat/bot-vm-spec`）。それまでの「有効なコネクターの `resources.memoryMiB` の最大まで VM のメモリを上げる（増やすときは再起動、減らすときは次の起動まで保留）」仕組みを置き換える。

## 1. 考え方

- VM の大きさはボットごとの設定で人が決める。コネクターが VM を大きくすることはない。
- 新しいボットは最初からデスクトップとブラウザが動くスペックで作る: **4 vCPU / 6 GiB / ディスク 20 GiB**（`DEFAULT_BOT_ENVIRONMENT_SPEC`、`shared/environment.ts`）。ただし作成時に環境の `capacity` を読み、その範囲に収める（§8）。
- コネクターは「最低限要るもの」を宣言する（`BotConnector.minimumSpec`、例 デスクトップ `{ memoryMiB: 4096 }`、ブラウザ `{ memoryMiB: 3072 }`）。足りないボットではそのコネクターを有効にできず、有効なコネクターの最低値より下げることもできない。
- スペックを変えるのは人が VM のページで保存したときだけ。そのとき動いている VM は確認のうえ停止 → 変更 → 起動する。それ以外で VM が勝手に再起動することはない。

## 2. コントラクト

- `BotEnvironmentSpec = { cpus, memoryMiB, diskGiB }`（正の整数）。`BotEnvironmentMinimum` はその一部のキー。
- `BotEnvironmentTarget = { id, name, spec }`（`resources` は消した）。`rows(bot)` は `{ id, name }` を取る（スペックは行に関係しない）。
- `BotEnvironment.capacity(botId)` → `BotEnvironmentCapacity`（キーごとの `{ min, max, step, growOnly? }`）。Host の実機と、同じ Host の他の環境がすでに取っている分から、ボットごとに環境が決める。bot-core は変える値をこれで検査し、環境は `ensure` で出せないスペック（縮むディスクなど）を断る。
- `BotEnvironment.inspect(botId)` → 既存の環境が今動いているスペック、無ければ `undefined`。
- `BotConnector.minimumSpec?`（登録時に検査: スペックのキーだけ、正の整数）。`ConnectorDescriptor.minimumSpec`（無ければ `{}`）。
- `ConnectorSwitchBlock` に `spec`（`{ key, need }`）と `spec-unread` を足した。`BotConnectorsSnapshot.spec` で画面も同じ規則を使う。
- Remote `botEnvironment`: `watch(botId)` → `BotEnvironmentView`（`spec?`、`capacity`（読めなければ理由）、`needs`（有効なコネクターの最低値）、`application`: `unread` / `applying`（段階）/ `applied` / `failed`）、`configure(botId, spec)`。
- 消したもの: `BotConnector.resources`、`BotEnvironmentResources`、`ConnectorDescriptor.resources`、準備の段階 `resources`、`EnvironmentState.resources`、`host/connectors/resources.ts`、`reconcileResources`、`BotCreationOptionOffer`（`BotCreationOffer` はオプションの一覧になった）、bot-vm の `memory.ts` と保留（`deferredMemory`）、`InstanceUpdate.unset`。

## 3. 保存（bot-core）

- 保存先は `dsh_bot_environment_specs`（version 1、表 `specs`、キーは bot id）: `{ spec, origin: "default" | "inspected" | "configured", updatedAt }`。書くのは `host/environment-spec/store.ts` だけ。
- 新しいボット: 何も保存する前に初期スペックを作り（§8）、記録の直後、コネクターを有効にする前に保存する（`registry.create` → `specs.initial` → `specs.create`。失敗したら消す）。
- 規則（`shared/environment.ts`、画面と Host で同じ関数）:
  - 変わるキーだけを検査する（今の値が今日の範囲の外でも、変えなければ残せる）。
  - 範囲: `min`〜`max`、`step` の倍数。
  - `growOnly` のキー（ディスク）は下げられない。
  - 下げる値が、有効なコネクターの `minimumSpec` より小さければ断る（「Desktop needs 4 GiB of memory or more」）。
  - コネクターを有効にするとき、スペックがその `minimumSpec` に足りなければ断る（`connectorSwitchBlock` の `spec`）。オンのままの保存・オフにする保存は断らない（requires の規則と同じ）。
- 検査の置き場所: コネクターの設定の保存とスペックの保存は **1 本の保存の列**（`host/save-queue.ts`、`botSettingsQueue`）を共有し、それぞれの検査は列の中で相手の今の状態を読む。だから「デスクトップを有効にする」と「メモリを下げる」が同時に来ても片方しか通らない。コネクター id は bot-core に書かない。
- Host は入力を信用しない: `parseEnvironmentSpec`（キーはちょうど 3 つ、正の整数）、容量は保存のたびに環境から読み直す。

## 4. 適用（bot-vm）

- 書く場所はインスタンス自身の設定: `limits.cpu`（数）、`limits.memory`（`<n>MiB`）、root ディスク（プロファイルの root を写し、`size: <n>GiB`）。プロファイル（`dsh-bot`）は変えない。プロファイルは root のプールを与えるだけになる。
- 作るとき: `start: false` で作り、最初の起動の前にスペックを書いてから起動する（root のプールはプロファイルから展開された root を使う）。
- 既存の VM（`host/reconfigure.ts`）: 動いている値（`expanded_config` / `expanded_devices`、プロファイル込み。値が無ければ Incus の既定 1 vCPU / 1 GiB）とスペックを比べる。
  - 違えば、動いている VM を停止 → 書く → 起動。
  - 同じで書き方だけ違えば（プロファイルの値で動いている、`4GiB` と `4096MiB`）、停止せずに書く。
  - ディスクがスペックより大きければ断る（縮められない）。
  - 共有（`raw.idmap`、workspace デバイス）の付け直しによる再起動は今までどおり。
- 設定の書き込みはインスタンスを読み直して全体を PUT（PATCH は使わない。書ける項目が欠けていたら断る）。
- 容量（`host/capacity.ts`）: CPU 1〜Host の論理 CPU 数、メモリ 1 GiB〜Host のメモリの 3/4、ただしプロジェクトの `limits.memory`（インスタンスの合計の上限）があれば、そこから他のインスタンスの `limits.memory` を引いた残り以下、を 512 MiB 単位、ディスク 10 GiB〜root のプールの大きさ（増やすだけ）。Incus の `/1.0/resources`、`/1.0/projects/<p>`、`/1.0/profiles/<p>`、`/1.0/storage-pools/<pool>/resources`、`/1.0/instances` から読む。
- Incus が変更を断ったとき（プロジェクトの上限など）は、停止した VM を起動し直してから ensure を失敗にする（止まったままにしない）。失敗したボットでスペックを保存し直すと、backoff を待たずにすぐ ensure し直す。

### 実測（Incus 6.0.4、Debian 13 cloud イメージ由来の dsh-bot-base、btrfs プール）

作者の環境での検証記録。サイズや時間はその環境での値。

- 新しい VM を root 20 GiB で作ると、最初の起動で cloud-init の `growpart` と `resizefs`（`frequency always`）がパーティションと ext4 を広げる: `df /` 19679M。
- 停止中に root を 24 GiB にして起動すると、起動のたびに走る同じ 2 つが広げる（`resize2fs /dev/sda2` 0.04 秒）: `df /` 23650M。手順は「停止 → `size` を書く → 起動」だけでよい。
- 縮める: Incus が断る（`Block volumes cannot be shrunk`）。
- 動いている VM に同じ値（`limits.cpu=2`、`limits.memory=2GiB`、root `size=10GiB` の上書き）を書く: 再起動しない（uptime が続く）。
- 動いている VM に書いた変更: root を大きくしても、`limits.cpu` を増やしても、ゲストからは見えない（`lsblk` と `nproc` は前のまま）。メモリを増やすのは Incus が断る（`Cannot increase memory size beyond boot time size`）。だから変わるときは必ず停止してから書く。

## 5. 既存のボットの移し方

- スペックを保存していないボット（この変更より前のボット）は、最初の `ensure` の前に環境の `inspect` を読み、**今動いているスペックをそのまま保存する**（`origin: "inspected"`）。VM が無ければ既定のスペック（`origin: "default"`、VM はそれで作られる）。読めなければ（CPU の集合 `0-3` など）ensure の失敗として backoff でやり直す。
- 保存されるのは実際の値なので、bot-vm はその値をインスタンスの設定に書くだけで再起動しない（作者環境の既存ボットの例: プロファイルの 2 vCPU / 10 GiB と、個別の `limits.memory 4096MiB` がそのまま入る）。
- 「未設定なら既定」の補完はしない: スペックの無いボットは ensure されず（読んでから ensure する）、VM のページは「読み込み前」を出し、コネクターの有効化も `spec-unread` で断る。
- 既定の 6 GiB などへ上げたいボットは、VM のページで上げて保存する（その場で再起動）。デスクトップが有効で 4096 MiB のボットはそのまま動き続ける。メモリ 3072 MiB のボットはデスクトップを有効にできず、VM のページで 4 GiB 以上にしてからになる。

## 6. 画面

- ボットの設定の「VM」ページ（`client/environment/`、order 250、Channels と Connectors の間）: 状態の行、CPU・メモリ（GiB、0.5 刻み）・ディスク（GiB）の入力、範囲・「増やすことだけできます」・コネクターが要るもの、断られる値はその理由。「保存して再起動」は確認「VM を再起動しますか？」を出す。未保存の値は画面のガードを掛ける。
- コネクターのカードのタグ（Main のみ、GiB）と作成ダイアログのメモリのタグは消した。スペックが足りないコネクターのトグルは押せず「メモリが 4 GiB 以上必要です。VM のページで増やしてください」。

## 7. infra

- VM ホストにプロファイルは無い（0.4.0、docs/specs/incus-endpoint.md §3.4）。bot-vm が作る VM はスペック・root のプール・NIC をすべてインスタンス自身の設定に書く。

## 8. 作成時のスペック（2026-11-24、`feat/core-portability`）

作者の Host 以外（CPU やメモリの少ない Host）でも、確かめずに 4 vCPU / 6 GiB / 20 GiB を保存して最初の ensure で失敗する、ということがないようにした。

- `initialEnvironmentSpec(capacity, needs)`（`shared/environment.ts`、画面と Host で同じ関数）: キーごとに `DEFAULT_BOT_ENVIRONMENT_SPEC` を `capacity` の範囲（`step` の倍数、`max` 以下）に収め、`min` と作成オプションのコネクターの `minimumSpec` を下回らない値にする。それができないキーは `shortfalls`（`need`、`available`、足りないコネクター）として返す。
- Host（`host/environment-spec/initial.ts`）: `registry.create` が何も保存する前に、新しいボットの id で `capacity` を読み、上の関数でスペックを作る。読めない、または足りなければ作成を断る（「Desktop needs 4 GiB of memory, but this Host can give a bot's VM at most 3 GiB」、オプション無しでも足りなければ「this Host cannot give a bot's VM the 1 GiB of memory it needs at least (at most 512 MiB)」）。スペックの無い既存ボットで VM も無いもの（§5 の `default`）も同じ関数で作る。
- `bots.creationOptions()` は `{ options: [{ option, needs }], capacity }` を返す（`capacity` はまだどのボットも持たない id で読む。新しいボットの id と同じ扱い）。
- 作成ダイアログではスペックを選ばせない（VM ページが変更の検査・再起動の確認をすでに持つので、同じ編集 UI を二重に持たない）。代わりに、選んだオプションで作られるスペックを読み取り専用の「VM」行に出し、Host が出せないオプションはオフで押せなくし、VM が作れないときはエラーを出して作成ボタンを押せなくする。
- 作成時のスペックの `origin` は `default` のまま（保存ドメインは変えていない）。
