# Incus の接続先の抽象（IncusEndpoint）

状態: 段階 1〜6 を実装（§11）。spike のコードと生の数値は `dev/incus-endpoint-spike/`。

この文書では「確認済み」は 2026-11-25 にこのホスト（Debian 13、Incus 6.0.4）で実際に動かして確かめたこと、「未検証」は試していないこと、「推測」は根拠が文書や読んだコードだけのことを指す。

## 1. 目的

- DSH のホストでは「DSH にプラグインを入れるだけ」で動く。NixOS / Arch / WSL の DSH ホストに Incus・socat・vsock・root の設定を求めない。
- VM を動かすホスト（以下 VM ホスト）は DSH ホストと別にできる。VM ホストは動作確認済みの Debian 13 / 12、Ubuntu 24.04、Fedora に限る。
- 次の 3 つの形を、接続先（IncusEndpoint）の差し替えだけで同じコードが扱う。
- dsh-bot-vm の操作はすべて 1 つの Incus project に閉じる。

## 2. 3 つの形

| 形                               | 接続                                          | 権限                                                           | project・ネットワーク・ACL を用意する人                   | DSH ホストに要るもの                                |
| -------------------------------- | --------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| 1. 同じマシン（local）           | Unix ソケット（`/var/lib/incus/unix.socket`） | サーバ全体（incus-admin）。プラグインが自分で project に閉じる | インストーラ（今と同じ VM ホスト用スクリプト）            | Incus 一式（= VM ホスト）。DSH ユーザが incus-admin |
| 2. 専用の VM ホスト（remote）    | `https://<host>:8443` + クライアント証明書    | 制限付き証明書（restricted、projects=[dsh-bots]）              | VM ホスト用スクリプト（今のインストーラの VM ホスト部分） | なし（DSH の Node と OpenSSH クライアントだけ）     |
| 3. 既存の Incus サーバ（remote） | 同上                                          | 同上                                                           | サーバの管理者が配布スクリプトで用意                      | なし                                                |

2 と 3 はプラグインから見て同じ（remote）。違いは誰が VM ホストを用意したかだけで、ACL の責任は 3 では管理者にある（§6.4）。

## 3. セットアップの流れ

### 3.1 形 1（local）

1. `install.sh`（`DSH_BOTS_ACCESS=local`、DSH を動かすユーザで実行）が VM ホストの準備（パッケージ、Incus、ストレージプール、ブリッジ、ACL、ファイアウォール、project `dsh-bots`、§3.4）を行い、DSH のユーザを `incus-admin` に入れる。共有フォルダの bind mount と `~/.ssh/config` の Include は作らない（§7）。プラグインは DSH に別に入れる（`dsh plugin --profile <p> add @1outres/dsh-bots@<版>` か Plugins 画面）。
2. DSH の「dsh-bots の設定」画面の「VM ホスト」で「このマシン」を選ぶ（既定）。プラグインはソケットに届くか、project・プール・ネットワークがあるかを調べ、足りないものとその直し方（install.sh の再実行）を示す。
3. イメージの取り込み（§5.5）は画面の「イメージ」で行う。

### 3.2 形 2（専用の VM ホスト）

1. VM ホストで `curl … | bash`（`DSH_BOTS_ACCESS=remote`、または問いに remote と答える）。パッケージ・Incus・プール・ブリッジ・ACL・ファイアウォール・project を用意し、`core.https_address`（未設定なら `:8443`）を設定し、最後に trust token を 1 つ出す（§4）。
2. DSH の画面の「VM ホスト」で「別のマシン」を選び、token を貼る。プラグインが証明書を作って登録する（§4）。
3. 画面がそのまま検査（§5.1 の `check`）とイメージの取り込みに進む。

### 3.3 形 3（既存の Incus サーバ）

1. 管理者が配布スクリプト `infra/incus/create-project.sh`（root 不要・incus のクライアントだけ、`--remote` で incus の remote に対しても。入口は `install.sh incus-project …`）を自分の Incus に対して実行する。引数は project 名、ストレージプール、ネットワーク（既存を指定するか、ブリッジを新しく作るか）、ACL（既存を指定するか、dsh-bots の既定 ACL を作るか。既存のネットワークへ付けるのは `--attach-acl` のときだけ）、上限（CPU・メモリ・ディスクは必須、VM 数）。スクリプトは §3.4 の project を作り、§8.2 の注意を示し、token を出す。サーバの設定（`core.https_address`）は変えず、未設定なら止まる。
2. 以降は形 2 と同じ。

### 3.4 project の中身（3 つの形で共通。スクリプトが作る）

```
incus project create dsh-bots   -c features.images=true -c features.profiles=true -c features.storage.volumes=true -c features.networks=false   -c restricted=true   -c restricted.networks.access=<network>   -c limits.virtual-machines=<n> -c limits.cpu=<n> -c limits.memory=<size> -c limits.disk=<size>   -c limits.disk.pool.<pool>=<size> -c limits.disk.pool.<他のプールすべて>=0   -c user.dsh-bots.pool=<pool> -c user.dsh-bots.network=<network> -c user.dsh-bots.egress-acl=<acl>
```

- `restricted=true` の既定のままにする（`restricted.devices.disk=managed`、`restricted.virtual-machines.lowlevel=block`、snapshots / backups は block）。
- Incus 6.0.4 には `restricted.storage-pools.access` が無い（設定すると "Invalid project configuration key"、確認済み）。使わせないプールは `limits.disk.pool.<name>=0` で塞ぐ（作成が "Reached maximum aggregate value "0"" で拒否される、確認済み）。
- ネットワークは default project のブリッジ。Incus の project は OVN 無しに自分のブリッジを持てないので `features.networks=false` のまま `restricted.networks.access` で 1 つだけ許す。
- `user.dsh-bots.*` は管理者が「どのプール・ネットワーク・ACL を使わせたか」を書く宣言。制限付き証明書から project の config は読める（確認済み）がネットワークと ACL の中身は読めない（§6.4）ので、プラグインはプールとネットワークの名前をここから読む。
- プロファイルは作らない。プラグインはインスタンスの config と devices（root のプール、NIC のネットワークと `security.port_isolation` / `mac_filtering` / `ipv4_filtering`、`security.guestapi=false`、`security.secureboot=false`）をインスタンスごとに書く。理由: project のどれか 1 つのプロファイルに許されないデバイス（許されないネットワークの NIC など）があると、そのプロファイルを使わないインスタンスやボリュームの作成まですべて "Invalid device … on profile …" で失敗した（確認済み）。プロファイルを作れる制限付き証明書がこれで project を壊せるので、プラグインは自分の正しさをプロファイルに依存させない。

## 4. ペアリング（形 2・3）

Incus の正規の方法（`incus remote add <token>` と同じ。[Incus: Authentication](https://linuxcontainers.org/incus/docs/main/authentication/)）を使う。

1. VM ホスト（管理者）: `incus config trust add dsh-bots-<DSH ホスト名> --restricted --projects dsh-bots` が token を出す。token は base64 の JSON で `client_name`、`fingerprint`（サーバ証明書の sha256）、`addresses`、`secret`、`expires_at` を持つ（確認済み）。
2. DSH（画面）: token を貼る。プラグインは token を解き、`addresses` の 1 つに HTTPS でつなぎ、サーバ証明書の sha256 が `fingerprint` と一致することを確かめる（一致しなければ止まる）。`addresses` が DSH ホストから届かない場所（NAT の内側など）を指すときは、画面で URL を上書きできる（固定する fingerprint は token のまま）。
3. プラグインが EC P-384 の鍵と自己署名証明書を作り、その証明書で TLS をつないだまま `POST /1.0/certificates {"type":"client","trust_token":"<token の文字列全体>"}` を送る。`trust_token` には token の文字列全体を入れる（`secret` だけだと 403 "not authorized"、全体で 200、確認済み）。token は 1 回で消える（確認済み）。
4. 登録された証明書は `restricted: true`, `projects: [dsh-bots]`（確認済み）。`GET /1.0` の `auth` が `trusted` になる。
5. 保存: URL、サーバ証明書の sha256、クライアント証明書は dsh-bot-vm の状態（§5.1 の EndpointStore）、秘密鍵は DSH の credential store（§6.2）。

外す・作り直す: 制限付き証明書は自分の証明書を消せない（`DELETE /1.0/certificates/<自分の fingerprint>` が 403 "Certificate is restricted"、2026-11-25 に確認済み）。画面の「VM ホストとの接続をやめる」は手元の記録を消し、管理者に `incus config trust remove <fingerprint の先頭 12 桁>` を案内する。

## 5. コントラクト

dsh-bot-vm の中のモジュール境界。型は実装の指針で、名前は実装時に詰める。

### 5.1 IncusEndpoint と IncusClient

```ts
type IncusEndpoint =
  | { readonly kind: "local"; readonly socket: string }
  | {
      readonly kind: "remote"
      readonly url: string // https://host:8443
      readonly serverCertificateSha256: string // ペアリングで固定。TLS の検証はこれだけ（CA を使わない）
      readonly clientCertificate: string // PEM
      readonly clientKey: CredentialKey // DSH の credential store の鍵（§6.2）
    }

interface IncusScope {
  readonly endpoint: IncusEndpoint
  readonly project: string // すべての要求に ?project= を付ける。default は使わない
}

interface IncusTransport {
  // 今の IncusTransport を広げる
  json(method, path, body?, signal?): Promise<IncusResponse>
  upload(path, body: ReadableStream<Uint8Array>, headers, signal?): Promise<IncusResponse>
  websocket(path, signal?): Promise<ByteChannel> // 双方向のバイト列。close で EOF
}

interface EndpointStore {
  // 状態。ロジックを持たない
  read(): Promise<StoredEndpoint | undefined>
  write(endpoint: StoredEndpoint): Promise<void>
  clear(): Promise<void>
}

interface EndpointCheck {
  // 「足りないもの」を列挙して止まるための結果
  readonly ok: boolean
  readonly problems: readonly { code: EndpointProblem; message: string; fix: string }[]
}
```

- `createIncusTransport(endpoint)` は local / remote で実装が違うだけで、その上の `IncusClient`（今の `src/host/incus.ts`）は 1 つ。IncusClient に足すもの: `exec`（§5.2）、custom volume（作成・取得・拡張・削除）、イメージ（取り込み・別名・取得・削除）、`server()`（`GET /1.0` の `auth`、`api_extensions`、`environment.server_version`）。
- `check(scope)`: 認証が `trusted`、project がある、`restricted=true`（local では任意。§6.1）、`user.dsh-bots.pool` / `network` が読めてプールとネットワークが使える、Incus 6.0.4 以上、VM が作れる（qemu ドライバ）。足りなければ `problems` を返し、ensure は失敗のまま（fail closed）。代わりの経路は使わない。
- local でも `default` project は使わない。今の本番の VM（default）は扱わない（§9）。

### 5.2 GuestTransport（exec 越しの SSH）

```ts
interface GuestTransport {
  /** ssh の Host ブロックの ProxyCommand 行。 */
  proxyCommand(instance: string): string
}
```

- 仕組み（確認済み）: ProxyCommand が `POST /1.0/instances/<vm>/exec` に `{command:["/usr/sbin/sshd","-i"], interactive:false, "wait-for-websocket":true, "record-output":false, user:0, group:0, environment:{}}` を送り、返る fd 0・1・2・control の 4 本の websocket につなぎ、自分の stdin → fd 0、fd 1 → stdout、fd 2 → stderr を中継する。stdin の EOF は fd 0 の websocket の close で伝わる。exec の終了コードは operation の `metadata.return`。
- `sshd -i`（inetd モード、[sshd(8)](https://man.openbsd.org/sshd.8#i)）なので VM の中で sshd が何も listen しなくてよい。イメージの sshd 設定（鍵のみ、`AllowUsers bot`、`AllowStreamLocalForwarding yes`）とホスト鍵がそのまま使われ、ssh の認証とホスト鍵の固定は今と同じ。`security.guestapi=false` でも exec は incus-agent 経由で動く（確認済み）。
- DSH ホストに socat・vsock・vhost_vsock は要らない。
- dsh-ssh は 1 つの SshConnection で ssh のマスターを 1 本だけ張り、ストリームはその多重化（`-O forward`）で通すので、exec の operation は SshConnection 1 つにつき 1 つ（dsh-ssh のコードからの推測。operation の数は数えていない）。
- ProxyCommand は DSH のプロセスの中で中継する（§10 の 1 で決定）: dsh-bot-vm が DSH のプロセスの中で Unix ソケット `<stateDir>/run/guest.sock`（ディレクトリ 0700）を listen し、ProxyCommand（`lib/guest-proxy.js`）は「そのソケットにつなぎ、インスタンス名を 1 行送り、`ok` を受けたらあとはバイト列を中継する」だけ。中継はボットのインスタンス（この owner が作り、動いているもの）だけを受け付ける。Incus への接続・証明書・秘密鍵・サーバ証明書の固定は DSH のプロセスの IncusClient 1 つだけが持ち、鍵がファイルにならず、ProxyCommand の引数に秘密が載らず、local と remote で ProxyCommand が同じ。DSH が止まれば SSH も止まるが、ボットの SSH 接続はもともと DSH のプロセスと一緒に終わるので失うものは無い。
  - 実装（`src/host/guest-transport.ts`、`src/node/guest-relay.ts`、`src/standalone/guest-proxy.ts`）で確認済み（2026-11-25、Unix ソケットの Incus）: `ssh -F <ボットの設定> <alias> 'id -un'` が 252–282 ms（初回 4.6 s）、SshConnection の ready まで初回 6.3 s（イメージから作った VM で helper が初めて読まれるため。spike の値と同じ傾向）。spike の独立した ProxyCommand（B）と同等。

### 5.3 ssh の設定の渡し方（spike c）

- dsh-ssh 0.2.2-rc.5 は `ssh -T -M -S <ctl> -o ControlPersist=no -o BatchMode=yes -o StrictHostKeyChecking=yes -o ForwardAgent=no -o ClearAllForwardings=yes -o ServerAliveInterval=10 -o ServerAliveCountMax=3 <host> <command>` を固定で spawn し、`host` は `^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$` の別名だけ。`-F`・`-o`・ProxyCommand・IdentityFile・known_hosts を渡す設定は無い（`src/index.ts` を読んで確認）。
- OpenSSH は利用者の設定を `getpwuid()` のホーム（`~/.ssh/config`）から読み、`$HOME` を見ない（`HOME=/tmp/x ssh -G` で確認済み）。`PATH` に ssh の包みを置く手はプロセス全体（DSH の他の ssh 利用すべて）に効くので取らない。
- したがって dsh-ssh のままでは `~/.ssh/config` の Include しか道が無い。これを避けるため、dsh-ssh の Host 側（`SshConnection`、MIT、約 400 行）を複製した自前の `ssh` サービスを `@1outres/dsh-bot-vm` に持つ（§10 の 2）。
  - 起動は `ssh -F <stateDir>/ssh/<id>.conf …`。`-F` を渡すと OpenSSH は `~/.ssh/config` も `/etc/ssh/ssh_config` も読まないので、利用者の設定に左右されない。設定ファイルには ProxyCommand（プロセス内の中継、§5.2）、IdentityFile、UserKnownHostsFile、HostKeyAlias、User を書く。
  - helper（VM の中）・`@deepseek-ai/dsh-ssh/protocol`・`@deepseek-ai/dsh-ssh/schemas` はそのまま使い、複製は Host 側の接続だけにする。複製元の版（0.2.2-rc.5）と LICENSE を明記する。
  - サービスの形（`request`、`connectStream`、`ready`、`ptcLaunch`、`dispose`）は dsh-ssh と同じにし、dsh-fs-ssh と dsh-subprocess-ssh が変更なしで動くことをテストで保つ。DSH の版を上げるときは、このテストと複製元との差分で追従する。
  - つなぎ直しと、使っていない接続を閉じる処理をサービスに組み込む（今の `./ssh` の包みが dsh-ssh の非公開の `failure`/`closed` を読む作りは無くなる）。実装: `src/node/ssh/connection.ts`（複製、`LICENSE.dsh-ssh`）、`src/host/reconnect.ts`（呼び出し中・開いたストリーム・リモートのハンドルが無い状態が `idleMs`、既定 5 分、続くと閉じる）、`src/plugins/ssh.ts`。dsh-fs-ssh と dsh-subprocess-ssh は `test/ssh-providers.test.ts`（本物の helper と、ssh の代わりのスタブ）で保つ。
- DSH ホストに要るのは OpenSSH のクライアント（`ssh`）だけ。

### 5.4 Workspace（custom storage volume）

```ts
interface WorkspaceVolume {
  readonly name: string // "<instancePrefix><botId>-workspace"
  readonly pool: string // user.dsh-bots.pool
  readonly sizeGiB: number
}
```

- **block の custom volume**（`content_type: block`）をインスタンスの disk デバイス `workspace`（`{type: disk, pool, source: <volume>}`、path なし） として付ける。ゲストには `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_workspace` で見える（確認済み。`/dev/sda`/`sdb` の順番は起動ごとに変わるので by-id を使う）。
  - filesystem の custom volume を `path` 付きで付けることも制限付きで許される（確認済み）が、VM には virtiofs で渡る（virtiofsd が要り、今の共有と同じ遅さ）。block はゲストの普通の ext4 で、VM ホストはその中身を mount しない。
- ゲストでの mount: cloud-init の `mounts` で fstab に次の 1 行を書き、`runcmd` で最初の mount の後に最上位を `bot`（1001:1001）に chown する。
  `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_workspace /home/bot/workspace ext4 defaults,x-systemd.makefs,x-systemd.growfs,x-systemd.device-timeout=60s 0 2`
  - `x-systemd.makefs`: ファイルシステムが無いときだけ作る。VM を 2 回作り直してもファイルが残った（確認済み）。
  - **cloud-init の `fs_setup` は使わない**: `partition: none, overwrite: false` でも既存の ext4 に `mkfs.ext4 -F` を走らせ、作り直した VM でワークスペースが空になった（確認済み。cloud-init.log に "Creating file system … -F /dev/sda"）。
  - `x-systemd.growfs`: ボリュームを大きくした後の起動で ext4 が広がる（3 GiB → 4 GiB で `df` 2.9G → 3.9G、確認済み）。
  - 所有者: ゲストの uid のまま（1001）。raw.idmap は要らない。guest root も普通に書ける（共有のときの "EIO" は無くなる）。
- 拡張: 動いている VM の block ボリュームは大きくできない（"In use"、確認済み）。止めてから `PATCH size`、起動で growfs。spec の変更（今も止めて変えて起動する）に入れる。縮小は拒否する（今の root と同じ）。
- 大きさ（段階 3 で決定）: BotEnvironmentSpec の `diskGiB` はワークスペースのボリュームの大きさ。root は dsh-bot-vm の設定 `rootDiskGiB`（既定 16 GiB、イメージは新しい VM で root を 3.1 GiB 使う（確認済み）。デスクトップのパッケージ込みで約 4.2 GiB）。bot-core の画面の文言と契約のコメントは「ワークスペースのディスク（ボットのファイル）」に直した。今あるコネクターの `minimumSpec` は `memoryMiB` だけで `diskGiB` を求めていない（コードで確認）。
- 寿命: VM を消してもボリュームは残る（確認済み）。`remove(botId)` は VM・鍵・ssh 設定をすぐ消し、ボリュームには `user.dsh-bot.orphaned` を付け、orphan の猶予（7 日）の後に片付けで消す（§10 の 4。どのインスタンスも使っていないときだけ）。`user.dsh-bot.id` / `user.dsh-bot.owner` をボリュームにも付ける（`PATCH` で付けられる、確認済み）。他の owner のボリュームには触れない。
- 速さ（確認済み、2 vCPU / 2 GiB、btrfs のプール）: 小さいファイル 2000 個の作成 154 ms（VM の root では 129 ms、今の virtiofs の README の値 1.7 s）、512 MiB の fdatasync 書き込みは初回 95–101 MB/s（btrfs の疎なファイルへの割り当て）、上書き 490 MB/s（root は 232–484 MB/s）。

### 5.5 イメージの取り込み

```ts
interface ImageRelease {
  readonly tag: string // release.env の IMAGE_TAG
  readonly manifestSha256: string // release.env の IMAGE_MANIFEST_SHA256
  readonly baseUrl: string // GitHub Releases の download URL
}
```

- プラグインが manifest を取り、sha256 を `manifestSha256` と照合し、部分ごとに取得・検査し、つないだ全体の sha256（= Incus の fingerprint）を確かめてから `POST /1.0/images`（`application/octet-stream`、統合 tarball をそのまま流す）で project に取り込み、別名 `dsh-bot-base` を付け替える。中身はインストーラの step 7 と同じで、置き場所が root のシェルからプラグインに移る。
- 確認済み: 制限付き証明書で 1.39 GiB の統合 tarball を HTTPS（loopback）で取り込めた（11.9 s。同じ fingerprint のイメージが default project に既にあったので、Incus が中身を共有して速かった可能性がある）。別名の作成・削除もできる。
- ダウンロードは DSH ホストが行い、`<stateDir>/images/` に置く（`Range` で再開、検査済みは取り直さない）。VM ホストに直接取らせる（`source.type=url`）手は、イメージサーバの形式（simplestreams）を要るので取らない。
- プラグインの版は 1 つのイメージの版（`release.env`）を指す。進捗は画面に出す。
- 段階 4 で実装（`src/host/image/`、`src/node/image-io.ts`）: 検査は install.sh の image ステップと同じ（manifest の sha256・format 1・DSH の版・部分の大きさの合計、部分ごとの大きさと sha256、つないだ全体の sha256、Incus が返す fingerprint の一致。合わない部分は消し、別の fingerprint で入ったイメージは消し戻す）。置き場所は `<stateDir>/images/manifests/<manifest sha256>.txt`（検査済み。手元にあればネットワーク無しで別名を確かめられる）と `<stateDir>/images/downloads/<manifest sha256>/<part>.partial`（`Range` で続き、60 s 無通信で失敗、検査後に `<part>` へ改名。別名を付けたら消す。ほかの版の分も消す）。取り込み前に残りの分の空き容量を確かめる。取り込みは同時に 1 つで、`ensure` は VM を作るときだけ合流して進捗 `image`（bot-core の `ENVIRONMENT_PHASES` に追加）を出し、失敗は理由と直し方で ensure を失敗させる。画面向けの状態とコントラクトは bot-core の `shared/environment-image.ts`（`BotEnvironmentImageView`、`BotEnvironmentImageHost`）。設定 `manageImage`（既定 on、off は別名をそのまま使う）、`imageBaseUrl` + `imageManifestSha256`（ミラー、両方か無し）、`imageUploadTimeoutMs`。release.env の値は `src/host/image/release-env.ts` に `export-image.sh` が書き、テストで一致を保つ。
- 確認済み（2026-11-26、Unix ソケット、専用 project）: image-20261124（1,459,423,733 bytes）を GitHub Release から取得して取り込み、別名 `dsh-bot-base` が fingerprint 9fa1dfcf… を指した。取得 41.5 s、ソケット越しのアップロードと Incus の処理 47.3 s。300 MiB を超えたところで取り消し（状態 failed / cancelled、`.partial` 315,603,529 bytes が残る）→ 再開で `Range` が 315603529 から始まり、同時に待った 2 つの ensure と画面の start でアップロードは 1 回。終わった後 `downloads/` は空で manifest だけ残る。別名だけ消した状態ではダウンロードもアップロードもせず別名だけ付け直した。確認用 DSH でボットを作ると、ensure が取り込みを行ってから VM を作り（進捗は 空き → ベースイメージを用意 → 作成 → 起動 → 接続）、Main まで進んだ。

### 5.6 BotEnvironment（bot-core の契約）への影響

- インタフェースは変わらない。`workspace`（`/home/bot/workspace`）も同じ。
- `remove` の説明は「VM、鍵、ssh 設定、ワークスペースのデータを含めて消す」で、今の incus-vm は Host のフォルダを残している。ボリュームにすると契約どおり消せる。消すか残すかは §10 の 4 で決め、bot-core の README（「ファイルは Host に残る」の記述 2 か所）と削除の確認文を合わせて直す。
  - 段階 3 で実装: bot-core の README の「ファイルは Host に残る」の記述を直した。削除の確認文（「データはすべて削除されます」）は猶予の後に消えるので変えていない。
- `capacity`: `GET /1.0/resources` とプールの `resources` と project の config は制限付きでも読める（確認済み）。`GET /1.0/storage-pools`（一覧）は拒否される（確認済み）ので、プールは `user.dsh-bots.pool` から名前で引く。共有のサーバでは「ホストのメモリの 3/4」はあてにならないので、上限は project の `limits.*` を先に見る（形 3 では管理者が必ず `limits.memory`/`limits.cpu`/`limits.disk` を付ける前提にする）。
- bot-core の機能が共有フォルダに頼っていないこと（コードで確認、実機の DSH では未検証。ファイルビューワー・ノート・スキル・AGENTS.md は該当箇所を読んだ。present と添付とコネクタはファイルの扱いを grep で追っただけ）: ファイルビューワー（`host/files.ts`、環境の `fs`）、AGENTS.md / SOUL.md（`host/workspace-files.ts`）、ノート（`host/notes/notebook.ts`）、スキル（`host/skills/library.ts`）、present（`host/channels/presented-delivery.ts`）、添付の保存（`host/channels/inbox-shell.ts`、環境の subprocess で書く）、コネクタ（`host/connectors/environment.ts`、環境の exec）はどれも環境の fs / subprocess だけを使い、Host のパスを使わない。Host のパス（`hostRoot`）を使うのは dsh-bot-vm だけ。

## 6. セキュリティ

### 6.1 権限

- 形 2・3: 制限付き証明書は project `dsh-bots` の中だけ。確認済みの可否（Incus 6.0.4、`restricted=true` の既定）:

| 操作                                                                                                                                                                                       | 可否                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| VM の作成・起動・停止・削除、`limits.cpu`/`limits.memory`、root の `size`（PUT）                                                                                                           | 可                                                                |
| `cloud-init.user-data`、`user.*`、`security.guestapi`、`security.secureboot`、`security.csm`、`security.nesting`（インスタンスの config で確認）                                           | 可                                                                |
| `boot.autostart`、NIC の `security.port_isolation`/`mac_filtering`/`ipv4_filtering`（プロファイルに書いて、それを使う VM の作成と起動で確認。インスタンスの devices に直接書く形は未確認） | 可                                                                |
| exec（websocket）                                                                                                                                                                          | 可                                                                |
| block / filesystem の custom volume の作成・拡張（止めた VM）・`user.*`・削除、インスタンスへの接続                                                                                        | 可                                                                |
| イメージの取り込み（API でのアップロード）、別名の作成・削除                                                                                                                               | 可                                                                |
| `GET /1.0/resources`、プールの `resources`、project の config、`GET /1.0/networks`（許されたものだけ見える）                                                                               | 可                                                                |
| `raw.idmap`（作成時・変更時とも）                                                                                                                                                          | 拒否 "Use of low-level "raw.idmap" … is forbidden"                |
| Host パスの disk（今の virtiofs の共有）                                                                                                                                                   | 拒否 "Attaching disks not backed by a pool is forbidden"          |
| `raw.qemu`                                                                                                                                                                                 | 拒否                                                              |
| `volatile.*`（例 `volatile.vsock_id`）                                                                                                                                                     | 拒否                                                              |
| proxy デバイス                                                                                                                                                                             | 拒否                                                              |
| 許されないネットワークの NIC、`limits.disk.pool.<p>=0` のプール                                                                                                                            | 拒否                                                              |
| スナップショット・バックアップ                                                                                                                                                             | 拒否（`restricted.snapshots`/`backups` = block）                  |
| project の config の変更、サーバの config、default project の参照・作成、ネットワーク・ACL の作成、`GET /1.0/storage-pools`                                                                | 拒否                                                              |
| ネットワークの config（`security.acls` を含む）の参照                                                                                                                                      | 見えない（`config: {}` が返る）                                   |
| ネットワーク ACL の参照                                                                                                                                                                    | 拒否（403）                                                       |
| 許されないデバイスを持つプロファイルの作成                                                                                                                                                 | **できてしまう**。その後 project のすべての作成が失敗する（§3.4） |

今のコードが使っていて禁止されるのは `raw.idmap` と Host パスの disk（共有フォルダ）だけで、どちらも custom volume で要らなくなる。`volatile.vsock_id` は読むだけ（vsock の経路をやめるので読まなくなる）。

- 形 1: Unix ソケットはサーバ全体の権限（root 相当）のまま。プラグインは project を必ず指定し、`default` を拒む。ソケットを使う限り Incus 側では縛れない。形 1 でも loopback の HTTPS と制限付き証明書を使えば同じ縛りになるが、`core.https_address` を開ける必要がある（§10 の 6）。

### 6.2 鍵と証明書の置き場所

| もの                                                   | 置き場所                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Incus のクライアント証明書の秘密鍵                     | DSH の credential store（`@deepseek-ai/dsh-credentials` の grant レコード、`<scope>/incus-client`）。bot-core の channel の秘密と同じ仕組み |
| クライアント証明書（公開）、URL、サーバ証明書の sha256 | `<stateDir>/endpoint.json`（0600）                                                                                                          |
| ボットごとの SSH クライアント鍵・ホスト鍵・known_hosts | 今と同じ `<stateDir>/bots/<id>/`（ssh が読むのでファイルのまま）                                                                            |

ProxyCommand は DSH のプロセスの中で中継する（§5.2）ので、Incus の秘密鍵はファイルにしない。

### 6.3 exec 越しの SSH の信頼

- Incus サーバ（とその管理者）は VM の中で何でもできる。これは今も同じ。
- サーバ証明書は ペアリングで固定した sha256 だけで検証する（CA・ホスト名を使わない）。
- SSH の層は残し、ホスト鍵の固定（`HostKeyAlias`、`StrictHostKeyChecking yes`、ホスト鍵は DSH ホストで作って cloud-init で入れる）も今のまま。exec の先を取り違えても（名前の付け間違い・同名の別インスタンス）ホスト鍵が違えば ssh が止まる。
- exec は root で `sshd -i` だけを起動する。コマンドはプラグインが固定し、ボットの入力は入らない。
- 制限付き証明書が漏れた場合に失うもの: その project の VM とワークスペース。サーバの他の project・ネットワーク・ACL は守られる（§6.1）。

### 6.4 ネットワークの ACL（形 3 は管理者の責任）

- 制限付き証明書からは、ネットワークの `security.acls` も ACL の中身も見えない（確認済み）。NIC に `security.acls` を付ける手も、`features.networks=false` の project では ACL を project の中で探して "Network ACL not found" になった（確認済み）。**API で ACL の有無を確かめることはできない。**
- そこでプラグインは 2 つを行う:
  1. 宣言: project の `user.dsh-bots.egress-acl` が空なら画面で警告する（管理者の申告で、検査ではない）。
  2. 実測: ensure の最後に VM の中から「つながってはいけない先」へ短い TCP 接続を試す（ゲートウェイの任意のポート、`10/8`、`172.16/12`、`192.168/16`、`169.254.169.254`、`100.64/10` の代表）。どれかがつながれば警告する（ボットは止めない。§10 の 5）。spike の ACL（egress 既定 allow）ではゲートウェイの 22 番につながった（= 警告が出るべき状態を検出できることは確認済み）。
- 形 1・2 はインストーラの ACL（今の `dsh-bot-egress`）をそのまま使う。

## 7. 今のスクリプト・文書の扱い

| もの                                                  | これから                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `install.sh`                                          | 段階 6 で決定: VM ホストの準備だけにする（packages / incus / firewall / project、形 1 は `incus-admin`、形 2 は https と token）。DSH ホストの役は持たない（プラグインは DSH の Plugins 画面か `dsh plugin add`）。イメージの取り込みと一時 VM の検査はプラグインの画面へ移した。VM での手の検査は `infra/vm/check-vm.sh` に残す |
| `host-setup.sh` packages                              | 残す（VM ホスト）。socat は要らなくなる。virtiofsd は Incus の依存として入るので明示はやめる。対象 OS から Arch・NixOS・WSL を VM ホストとしては外す（DSH ホストとしては引き続き対象）                                                                                                                                           |
| `host-setup.sh` incus                                 | 残す。加えて project（§3.4）を作る。プロファイル `dsh-bot` は作らない（§3.4）。`incus-admin` に DSH ユーザを入れるのは形 1 だけ                                                                                                                                                                                                  |
| `host-setup.sh` firewall                              | 残す（VM ホスト）                                                                                                                                                                                                                                                                                                                |
| `host-setup.sh` workspaces                            | 消す（bind mount、`incus.service` の `RequiresMountsFor`、`~/.ssh/config` の Include はどれも要らなくなる。プラグインはボットごとの設定を `ssh -F` で渡す、§5.3）                                                                                                                                                                |
| 新規 `host-setup.sh local` / `remote`                 | local: `incus-admin`。remote: `core.https_address`（既定 `:8443`）、ufw / firewalld のポート、trust token の発行。ACL・ブリッジ・project・token は `infra/incus/objects.sh` で形 3 と共有                                                                                                                                        |
| 新規 `infra/incus/create-project.sh`                  | 形 3 の管理者向け（§3.3）                                                                                                                                                                                                                                                                                                        |
| `import-image.sh`                                     | 消す（プラグインが取り込む）                                                                                                                                                                                                                                                                                                     |
| `check-vm.sh`                                         | VM ホストの検査（VM が起動し exec が通り HTTPS が出る）に絞る。共有フォルダと vsock の検査は消す                                                                                                                                                                                                                                 |
| `infra/nixos/dsh-bots.nix.in`                         | NixOS は DSH ホストとしてだけ扱うので消す                                                                                                                                                                                                                                                                                        |
| `build-base-image.sh` / `provision-base.sh`           | 当面そのまま。後で: `sshd-vsock.socket` を外す（exec では使わない）、ワークスペースの mount をイメージの unit にする（§10 の 7）                                                                                                                                                                                                 |
| `docs/agent-setup.md`                                 | 2 つに分ける（VM ホストの準備 / DSH ホストでのプラグインの追加と画面でのペアリング）。「`~/.dsh/bots` の mount を弱めない」の行は消す                                                                                                                                                                                            |
| `docs/specs/installer.md`                             | §2 のステップ表と §3 の OS 表を VM ホスト用に書き直し、§3.1 NixOS・§4 WSL は DSH ホスト側の記述にする                                                                                                                                                                                                                            |
| `packages/dsh-bot-vm/README.md`、`infra/vm/README.md` | 共有フォルダ・vsock・socat の節を、endpoint・exec・volume の説明に置き換える                                                                                                                                                                                                                                                     |
| `packages/dsh-bot-core/README.md`                     | 「ファイルは Host に残る」「`hostRoot`」の記述を直す                                                                                                                                                                                                                                                                             |
| `README.md`（リポジトリの入口）                       | 1 行のインストールを「VM ホストの準備」と「DSH にプラグインを入れて画面でつなぐ」の 2 つに分けて書く                                                                                                                                                                                                                             |

## 8. spike の結果

### 8.1 exec 越しの SSH と今の vsock の比較

同じ VM（2 vCPU / 2 GiB）に 3 つの経路で接続した。exec+HTTPS = 制限付き証明書で loopback の 8443、exec+ソケット = Unix ソケット、vsock = 今の `vsock-proxy.js` + socat。

| 測ったもの                                      | exec+HTTPS                                | exec+ソケット   | vsock           |
| ----------------------------------------------- | ----------------------------------------- | --------------- | --------------- |
| `ssh <alias> true`（接続から終了、10 回の平均） | 346 ms                                    | 292 ms          | 295 ms          |
| dsh-ssh の handshake（`ready` まで）            | 660 ms                                    | 592 ms          | 621 ms          |
| `fs.stat` の往復（50 回）                       | p50 2.5 / p95 3.5 ms                      | 2.3 / 3.2 ms    | 2.0 / 3.2 ms    |
| subprocess で `true`（10 回）                   | p50 184 ms                                | 174 ms          | 188 ms          |
| `fs.writeText` 32 MiB                           | 2674 ms（12.0 MiB/s）                     | 1314 ms（24.4） | 1160 ms（27.6） |
| `fs.streamText` 32 MiB                          | 1825 ms（17.5 MiB/s）                     | 1562 ms（20.5） | 1256 ms（25.5） |
| subprocess の stdout 64 MiB                     | 59 MiB/s                                  | 52 MiB/s        | 81 MiB/s        |
| subprocess の stdin 32 MiB                      | 45 MiB/s                                  | 49 MiB/s        | 53 MiB/s        |
| `ssh` で 256 MiB 下り / 上り                    | 78 / 78 MiB/s                             | 77 / 87 MiB/s   | 99 / 116 MiB/s  |
| 8 本の SshConnection を同時に                   | 全部 ready まで 2955 ms、`stat` p50 13 ms | 2364 ms、16 ms  | 2222 ms、10 ms  |
| 32 本の ssh を同時に（各 `sleep 3`）            | 7.9 s、32/32 成功                         | –               | 5.3 s、32/32    |

- dsh-ssh / dsh-fs-ssh / dsh-subprocess-ssh は exec の経路で変更なしに動いた（bot-vm と同じ組み方: SshConnection + BotVmFileSystem + SshSubprocessRuntime。sandboxPolicy だけ DSH の外で動かすための置き換え）。
- 往復の遅れは変わらない。大きな転送は vsock の 6〜8 割。ProxyCommand の websocket の中継（JS でのマスク処理）を直せば縮む見込み（推測）。数 MB〜数十 MB のファイルの読み書きは秒以下〜2.7 s で、ボットの道具の使い方では問題にならない（推測）。

### 8.2 再起動

| 出来事                                                   | exec の経路                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | vsock                                                                               |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| VM の再起動（`incus restart`、2.3 s で戻る）             | 張っていた SSH は即切れる。新しい接続は 27.9 s（HTTPS）/ 34.3 s（ソケット）後に通った                                                                                                                                                                                                                                                                                                                                                                                        | 即切れる。27.9 s 後に通った                                                         |
| **incusd の再起動**（`systemctl restart incus.service`） | **張っていた SSH があると incusd の停止が exec の operation の終わりを `core.shutdown_timeout`（既定 5 分）まで待つ**。その間（t+1 s〜t+300 s）は deactivating で、張っていた SSH はそのまま動き続け（1 回目の試験で t+246 s まで出力が続いたのを確認）、読み取りの API も答えたが、**新しい exec（= 新しい SSH、張り直し）は失敗し続けた**。300 s で incusd が止まると張っていた SSH も切れ（exit 255）、再起動全体は 303.9 s かかった。その後の新しい接続は 0.4 s で通った | **切れない**（停止の間も 1 秒ごとの出力が続いた）。再起動後の新しい接続もすぐ通った |

- incusd の再起動（Incus の更新など）で、exec の経路は「最大 5 分、新しい接続と張り直しができず、その後すべて切れる」。張ってある接続はその間も使える。切れた後の振る舞い（実行中の呼び出しは失敗、次の呼び出しで張り直し、helper は SSH の EOF で後片付け）は今の VM 再起動と同じで、`Reconnector` がそのまま扱う。
- 逆向きの影響: dsh-bots の SSH が張ってある限り、VM ホストの管理者の `incusd` の停止・再起動は `core.shutdown_timeout` まで待たされる。形 3（他の用途の Incus サーバ）ではこれが管理者の運用に響く。
- これが vsock に比べた唯一の大きな後退（vsock の SSH は incusd の再起動の間も切れなかった）。
- 緩和: VM ホストの `core.shutdown_timeout` を短くする（形 1・2 はインストーラが設定できる。形 3 は管理者次第）。プラグインが incusd の停止を知って自分の exec を先に閉じる手は、`/1.0/events` に停止の通知が来るかを確かめていない（未検証）。

### 8.3 その他の確認

- ペアリング・制限の可否・イメージの取り込み: §4、§6.1、§5.5。
- custom volume: §5.4。
- VM の作成（イメージが展開済みのプール）: 100 ms で作成、起動から SSH まで 42–44 s。初めてのプールではイメージの展開があり、最初の作成は 2 分を超えた（正確な時間は測っていない）。

## 9. 残る課題と未検証のこと

- 確認済み（2026-11-25、段階 3、確認用 DSH・形 1・Unix ソケット・project `dsh-bots-test`）: ボット作成（ボリューム作成・インスタンスに直接書いた VM・cloud-init の mount）、会話でのファイル作成と bash、ファイルビューワー（一覧とプレビュー）、present、ノート、スキル、チャネルからの添付の保存（`.inbox/…/report.csv` が VM のボリュームに bot の所有で書かれた）、VM を外で消した後の作り直しでファイルが残る、VM ページでのワークスペース 20 → 22 GiB（止めて拡張して起動、`df` 22G）、ボット削除で VM が消えボリュームに orphan の印。
- 確認済み（2026-11-26、段階 6）: 別のマシンからの remote。入れ子の VM（Debian 13、install.sh の形 2）とペアリングし、イメージを取り込み、ボットを作って会話した。token の `addresses` は `:8443` のとき VM ホストのすべての IPv4 アドレス（外向きと `dshbr0` の `10.240.80.1`）を並べた。**未検証**: NAT・遅い回線での数値。
- **未検証**: WSL・NixOS・Arch の DSH ホスト（プラグインだけで動くはずだが試していない）。
- 制限付き証明書は自分の証明書を消せない（確認済み、§4）。**未検証**: 証明書の期限（作った証明書は 10 年）と更新の手順。
- 段階 6 で、Debian 12・Ubuntu 24.04（Zabbly 6.0.7）・Fedora 43（6.23）で install.sh の形 2 が project を作り token を出すことを確かめた。**未検証**: それらの Incus で §6.1 の表が同じか（ペアリングと VM の作成は Debian 13 の 6.0.4 だけで確かめた）。新しい版の Incus には `restricted.storage-pools.access` がある（文書で確認）。
- incusd の再起動で最大 5 分止まる（§8.2）。
- プロファイルで project が壊れる（§3.4）: プラグインはプロファイルを使わず、`check` で「project に許されないデバイスを持つプロファイルがある」を見つけたら止まって名前を示す。
- 今の本番のボット（default project、virtiofs の共有）: 引き継がない。新しい版は default を扱わないので、今の VM と Host のフォルダには触れない。古い VM の片付けの案内（`incus delete` と `~/.dsh/bots`）は README に書く。
- 1 台の VM ホストだけ。ボットごとの置き場所の選択は後回し（`IncusScope` をボットごとに持てば広げられる形にしておく）。

## 10. 決めたこと

1. ProxyCommand は DSH のプロセスの中で中継する（A、§5.2）。Incus の鍵はファイルにしない。
2. ssh の設定は `~/.ssh/config` を使わない。dsh-ssh の Host 側（`SshConnection`、MIT）を複製した自前の `ssh` サービスを持ち、`ssh -F <プラグインが管理するボットごとの設定>` で起動する。helper・`./protocol`・`./schemas` は dsh-ssh のものをそのまま使う。サービスの形は dsh-ssh と同じにし、dsh-fs-ssh と dsh-subprocess-ssh が変更なしで動くことをテストで保つ。接続が切れた後のつなぎ直しと、使っていない接続を閉じる処理はこのサービスに組み込む（dsh-ssh の非公開の状態は読まない）。
3. incusd の再起動での後退は受け入れる。使っていない接続を閉じて影響を小さくし、形 3 の管理者向け文書に書く。
4. ボットを消したとき、ワークスペースのボリュームは VM と同じく orphan の猶予（7 日）の後に消す。
5. ACL は宣言と VM の中からの実測で調べ、警告だけにする。
6. 形 1 は Unix ソケットのまま。project への限定はコードで守る。
7. ワークスペースの mount は当面 cloud-init で入れ、次のイメージで unit に移す。
8. プロファイルを使わず、インスタンスに直接書く。

## 11. 実装の段階（worktree）

変更範囲が重なるので、基本は順に進める。

1. `feat/incus-endpoint-client`: `IncusTransport`（unix / https + 固定）、`IncusClient` の拡張（exec・websocket・volume・image・server）、`EndpointStore`、`check`、ペアリング（token）。単体テストは偽の HTTPS サーバで。本体の振る舞いはまだ変えない。
2. `feat/guest-exec-transport`: 自前の `ssh` サービス（§10 の 2）と、プロセス内で中継する GuestTransport（§10 の 1）。ボットごとの ssh 設定を `-F` で渡す。vsock-proxy と socat、`~/.ssh/config` の Include を消す。
3. `feat/workspace-volume`: volume の作成・接続・拡張・削除、cloud-init の mount、`hostRoot`/`raw.idmap`/`guestUid` 周りを消す。プロファイルをやめ、インスタンスに直接書く。`default` project を拒む。ここで確認用 DSH（形 1）で bot-core の一通りを試す。
4. `feat/image-import`: プラグインからのイメージの取り込み（Host 側の状態とコントラクトまで。画面は 5）。
5. `feat/endpoint-ui`: 設定画面（VM ホストの選択、token、検査結果、ACL の警告）。2〜4 と並べられる（画面だけ。API が固まってから）。
   - 実装（2026-11-26）: bot-core の `BotEnvironment.host`（`BotEnvironmentHost`）と Remote `botEnvironmentHost`、dsh-bots 設定の「VM host」（docs/specs/ui-design.md）。保存は `endpoint.json` の version 2（endpoint と project）。実行中の切り替えは scope ごとの IncusClient に委譲し、切り替え後にボットを ensure し直す。ACL の実測は ensure の最後（`src/host/egress-probe.ts`）。確認済み（確認用 DSH、project `dsh-eui`）: 形 1 の検査・project の変更と問題の表示・ボット作成後の実測「隔離されています」、`core.https_address=127.0.0.1:8443` での形 2 のペアリング（指紋の表示、制限付き証明書の登録、HTTPS 越しの exec/SSH）、解除と trust remove の案内、指紋が違う token の拒否。未検証: 別のマシンからの形 2・3、取り込み中の切り替え。
6. `feat/installer-split`: install.sh / host-setup.sh / 新しい管理者スクリプト / 文書（§7）。
   - 実装（2026-11-26）: install.sh は VM ホストの準備だけ（6 ステップ、`DSH_BOTS_ACCESS=local|remote`）、`infra/incus/create-project.sh`、`check-vm.sh` を project の中の手の検査に、`build-base-image.sh` / `export-image.sh` を project の中に。`import-image.sh` と `infra/nixos/` を消した。設定画面はペアリング中に今の置き場所の行と検査を出さず、project の欄を 1 つにした。クライアント証明書の有効期間の始まりを 1 日前にした（VM ホストの時計が 1 秒未満遅れただけで "The provided certificate isn't valid yet" で拒まれたため、確認済み）。確認は docs/specs/installer.md §10 と同じ形で行った（結果は段階 6 の報告）。
7. 別のマシンでの形 2・形 3 の通しの確認と §9 の未検証の解消。

## 付録: spike で作ったもの（すべて片付け済み）

- Incus: project `dsh-spike`（中に VM `spk-a`、custom volume `ws-a`、イメージ `dsh-bot-base` の別名、プロファイル `dsh-bot`）、ストレージプール `dshspike`（btrfs 40 GiB の loop）、default project のブリッジ `dshspk0` と ACL `dsh-spike-egress`、trust の証明書 `dsh-spike-client`。サーバの `core.https_address` を一時的に `127.0.0.1:8443`（元は未設定）。
- ファイル: `/tmp/dsh-spike/`、`/var/tmp/dsh-spike/`（イメージの export）。
- incusd を 2 回再起動した（11:10 と 11:25 頃。本番の VM は動いたまま、vsock の SSH は切れなかった）。
