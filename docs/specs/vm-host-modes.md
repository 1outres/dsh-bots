# VM ホストの形（managed / custom、場所、backend）

状態: 仕様（段階 3b〜6 まで実装）。docs/specs/incus-endpoint.md の形 1〜3 と docs/specs/installer.md の install.sh を、この文書で改める（§11 の段階で実装する）。

この文書では「確認済み」は実際に動かすか、コードや型を読んで確かめたこと、「未検証」は試していないこと、「推測」は根拠が文書や一般的な知識だけのことを指す。読んだものは本文に書く。

## 1. 目的

- DSH にプラグインを入れるだけでインストールが終わる。VM ホストの準備（パッケージ、Incus、ファイアウォール、接続）は設定画面から行い、シェルで install.sh を実行させない。
- 「誰が用意するか」「どこ」「何で」を別の軸にする。今のコードの local / remote は接続の方式（Unix ソケットか HTTPS か）の区別にすぎず、用意した人と場所を表していない。
- 接続の方式を 1 つ（HTTPS と制限付きの資格）にする。このマシンでも別のマシンでも権限は project に閉じる。
- Incus 以外の backend（Proxmox）を入れられる形にする。

## 2. 3 つの軸と 3 つの選択肢

| 軸      | 値                             | 意味                                                                                        |
| ------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| origin  | managed / custom               | managed: プラグインが VM ホストを構築し、修復・更新できる。custom: 既にあるサーバを使うだけ |
| site    | このマシン / 別のマシン（SSH） | managed のときだけ意味がある。プラグインが root の手順を実行する場所                        |
| backend | Incus / Proxmox                | VM を動かす仕組み。managed は Incus だけ                                                    |

画面の選択肢は 3 つ:

| 選択肢             | origin  | site       | backend                                    | 利用者がすること                                                        |
| ------------------ | ------- | ---------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| このマシンに構築   | managed | このマシン | Incus                                      | sudo のパスワードを入れる                                               |
| 別のマシンに構築   | managed | SSH        | Incus                                      | プラグインの公開鍵を VM ホストの authorized_keys に足し、指紋を確かめる |
| 既存のサーバを使う | custom  | —          | Incus（trust token）/ Proxmox（API token） | サーバの管理者から受けた token を貼る                                   |

今の形との対応:

| 今                                                   | これから                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 形 1（local、install.sh、Unix ソケット）             | このマシンに構築（managed）。loopback の HTTPS と制限付き証明書（§6.4）。既存の利用者は移行（§8） |
| 形 2（remote、VM ホストで install.sh、token を貼る） | 別のマシンに構築（managed、SSH）。token はプラグインが発行させて自分で使う                        |
| 形 3（既存の Incus、create-project.sh）              | 既存のサーバを使う（custom、Incus）                                                               |
| —                                                    | 既存のサーバを使う（custom、Proxmox）。§10                                                        |

Incus の project の中身（incus-endpoint.md §3.4）、ペアリングの仕組み（§4）、exec 越しの SSH（§5.2）、ワークスペースのボリューム（§5.4）、イメージの取り込み（§5.5）、ACL の宣言と実測（§6.4）は変えない。

## 3. managed のフロー

### 3.1 全体

1. 利用者は DSH にプラグインを入れる（Plugins 画面か `dsh plugin add`）。ほかに何もしない。
2. 「dsh-bots の設定 → VM host」で場所を選ぶ（§2 の 3 つ）。
3. 事前検査（§3.4）。root を使わない。
4. 確認（§3.5）。sudo のパスワード、第三者リポジトリの同意、SSH のホスト鍵の指紋（SSH のときは事前検査より前、§3.3）。
5. 実行（§3.6）。ステップごとの進捗を画面に出す。trust token の発行とペアリングまでプラグインが行い、利用者は token を見ない。
6. 終わると画面は今の「Check」「Network isolation」「Base image」に戻る。

VM ホストを選ぶまで、ボットの ensure は問題 `placement-none`（直し方: 設定画面で VM ホストを選ぶ）で失敗する。今の「何も選ばなければこのマシンのソケット」という既定は無くす（§8.5）。

### 3.2 このマシンに構築

1. 「このマシンに構築」を選ぶ。project 名（既定 `dsh-bots`）と HTTPS のポート（既定 8443）は詳細の欄で変えられる。
2. 事前検査を DSH のユーザで実行する（§3.4）。NixOS / Arch / WSL / RHEL 系などで VM ホストになれなければ、理由と「別のマシンに構築」への行を出して止まる。
3. 確認: sudo のパスワード（不要なら出さない）、Zabbly の同意（Debian 12 / Ubuntu 24.04 だけ）、変えるものの一覧（入れるパッケージ、作る Incus の資源、ファイアウォール、`core.https_address` の決め方（§3.7。今の値は root の段でしか読めないので、決めた値は実行の後に示す））。
4. 実行: packages → incus → firewall → 接続 → イメージ（§3.6）。

### 3.3 別のマシンに構築（SSH）

1. 「別のマシンに構築」を選び、`user@host`（ポートは任意）を入れる。user は root でも sudo できる一般ユーザでもよい。
2. プラグインが専用の ed25519 鍵を作り（無いときだけ）、authorized_keys に足す 1 行を示す（Copy）:
   `restrict ssh-ed25519 AAAA… dsh-bots@<DSH ホスト名>`
   `restrict` で転送・pty・agent を塞ぐ。コマンドの実行はできる（OpenSSH 7.2 以上、推測: 対象の OS はすべて満たす）。
3. 利用者が「つなぐ」を押すと、プラグインは `ssh-keyscan` でホスト鍵を取り、指紋（`SHA256:…`）を示す。VM ホストで確かめるコマンド（`ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`）を meta に出す。利用者が一致を確かめて「この鍵を信頼する」を押すと固定する（§6.3）。
   - 順番の理由: 信頼していないホストでコマンド（事前検査）を実行しないため、ホスト鍵の確認を事前検査の前に置く。
4. 固定した鍵で SSH がつながるか（`BatchMode=yes`）を確かめる。公開鍵が足されていなければ「authorized_keys に足してください」で止まる。
5. 事前検査を SSH 越しに実行する（§3.4）。
6. 確認: sudo のパスワード（不要なら出さない）、Zabbly の同意、変えるもの、構築後の SSH 鍵を「残す（修復・更新に使う）」か「消す」か（既定は残す）。
7. 実行（§3.6）。接続の段では、DSH ホストから `https://<host>:<port>` に届くかを確かめる。届かなければ失敗 `endpoint-unreachable`（直し方: VM ホストの外のファイアウォール、クラウドのセキュリティグループでポートを開ける）。
8. 「消す」を選んでいたら、成功の後に authorized_keys から自分の行を消し（§6.2）、手元の鍵を消す。

### 3.4 事前検査

root を使わず、`host-setup.sh --events preflight` を VM ホストで実行して結果を受ける（§5.5）。

| id            | 見るもの                                                                                           | だめなとき                                                                           |
| ------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `arch`        | `uname -m` が x86_64                                                                               | 止まる                                                                               |
| `os`          | `/etc/os-release`、WSL（`detect_os`、installer.md §3）                                             | 止まる。NixOS / Arch / WSL / RHEL 系は「別のマシンに構築」へ誘導（このマシンのとき） |
| `kvm`         | `/dev/kvm` がある                                                                                  | 止まる。ファームウェアの VT-x / AMD-V か入れ子の仮想化を示す                         |
| `init`        | systemd が PID 1                                                                                   | 止まる                                                                               |
| `disk`        | `/var/lib` の空き（20 GiB 以上）                                                                   | 止まる                                                                               |
| `privilege`   | root か、`sudo` があるか、`sudo -n true` でパスワードが要るか                                      | sudo が無い一般ユーザなら止まる                                                      |
| `incus`       | Incus が既に入っているか、その版（`incus --version` はクライアントの版。サーバの版は root の段で） | 警告だけ（既存の Incus を使う。§3.6 の incus で project の衝突を見る）               |
| `third-party` | Zabbly が要る OS か                                                                                | 同意を求める（§3.5）                                                                 |
| `port`        | HTTPS のポートを他のプロセスが listen していないか（`ss -ltnH`）                                   | 止まる。Incus 自身が listen しているときは問題にしない（§3.7）                       |

- 結果は SetupInspection（§5.6）。画面は id ごとに 1 行を出す。
- `core.https_address` の今の値は一般ユーザから読めない（Incus のソケットは root:incus-admin、推測）。読めるのは root の段（§3.7）。

### 3.5 確認

- sudo のパスワード: 事前検査で要るとわかったときだけ欄を出す。実行の要求に一度だけ載せる（§6.1）。
- 第三者リポジトリ: Debian 12 / Ubuntu 24.04 で Zabbly（`pkgs.zabbly.com`、署名鍵の指紋 `4EFC5906…C838DCFD`）を足すことに同意するスイッチ。同意が無ければ実行できない。
- SSH のホスト鍵: §3.3 の 3 で固定済み。確認画面では固定した指紋を表示する。
- 既存の project: project が既にあり、他の owner のインスタンスかボリュームがあれば、incus の段が失敗 `project-in-use` で止まる。同じ owner のもの（修復・移行）は続ける。

### 3.6 実行とステップ

画面のステップは 5 つ。host-setup.sh のフェーズとプラグインの処理を次のように束ねる。

| ステップ | 中身                                                                                                                                                  | root | どこで    |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------- |
| packages | host-setup.sh `packages`（OS ごとのパッケージ、Zabbly、`vhost_vsock`、Incus 6.0.4 以上と qemu）                                                       | ✓    | VM ホスト |
| incus    | host-setup.sh `incus`（プール、ブリッジ、ACL、project、§3.5 の衝突の検査、`core.shutdown_timeout` は変えない）                                        | ✓    | VM ホスト |
| firewall | host-setup.sh `firewall`（installer.md §4）                                                                                                           | ✓    | VM ホスト |
| 接続     | host-setup.sh `https`（§3.7）と `token`（制限付き token、古い自分の証明書の削除）→ DSH でペアリング（incus-endpoint.md §4）→ `check`（§5.1 の check） | ✓    | 両方      |
| イメージ | プラグインのイメージの取り込み（incus-endpoint.md §5.5）。既に別名があれば skipped                                                                    | –    | DSH       |

- root のフェーズ（packages〜token）は 1 回の sudo で 1 つのプロセスとして順に実行する（§6.1）。フェーズの開始・完了・失敗は JSON lines で受ける（§5.5）。
- 冪等: host-setup.sh の各フェーズは調べてから変える（installer.md §7 と同じ）。変えるものが無ければ `changed: false` を返し、画面は skipped（済み）にする。途中で止まったら、同じ選択で「もう一度」を押せば続きから進む。
- 取り消し: 今のコマンドが終わったところで止める（§5.4 の制御行）。パッケージの導入の途中では切らない。
- 同時に 1 つ: 走っているジョブがあれば新しいジョブを拒む（`setup-busy`）。
- ペアリングの後の placement の書き込みは 1 回（§5.1）。ジョブが失敗している間は今の placement を変えない。接続の段は「ペアリング → placement の書き込み → check」の順で、check が失敗すると（`check-failed`）placement は書いた後になる（判断: check は書いた placement の backend でしか行えないため。画面の Check と修復がそのまま使える）。構築後に SSH 鍵を「消す」ときは、成功の後に site の `identity` だけを書き換える。イメージのステップの失敗では placement は書いた後なので、ボットは使えるがイメージが無い状態になり、「Base image」が今と同じに直し方を出す。

### 3.7 `core.https_address` の扱い

host-setup.sh の `https` フェーズ（root）が今の値を読み、次のように決める。決めた値は fact（§5.5）で返し、接続のステップの注記と完了の画面に出す。今の値は一般ユーザから読めない（§3.4）ので、確認画面では決め方（下の表）だけを示す。

| 今の値                                                                 | このマシン                                            | 別のマシン                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------- |
| 未設定                                                                 | `127.0.0.1:<port>` に設定。ufw / firewalld は触らない | `:<port>` に設定し、ufw / firewalld でポートを開ける（今の `remote` と同じ） |
| loopback を含む（`:8443`、`0.0.0.0:8443`、`[::]:8443`、`127.0.0.1:N`） | 変えない。`https://127.0.0.1:<そのポート>` を使う     | 変えない。`https://<host>:<そのポート>` を使う                               |
| 特定のアドレスだけ（`10.0.0.5:8443` など）                             | 変えない。`https://<そのアドレス>` を使う             | 変えない。そのアドレスが DSH から届かなければ接続の段で失敗する              |

- 既に設定されている値は他の利用者が使っているかもしれないので変えない（今の `phase_remote` と同じ考え）。
- このマシンで既に `:8443`（全アドレス）で公開されていても、それは今の管理者の設定として残す。プラグインはポートを閉じない。

## 4. custom のフロー

### 4.1 Incus（trust token）

今の形 3 と同じ（incus-endpoint.md §3.3、§4）。画面は「既存のサーバを使う → Incus」で token を貼り、指紋・期限・アドレス・project を確かめてペアリングする。

管理者が project と token を作るスクリプトは `infra/incus/create-project.sh` のまま。入口は install.sh の `incus-project` をやめ、リリースのタグのソースから取る（§9.2）。画面の「既存のサーバを使う → Incus」に、プラグインの版に合わせたコマンドを Copy で出す:

```sh
curl -fsSL https://codeload.github.com/1outres/dsh-bots/tar.gz/v<版> | tar -xz --strip-components=1 dsh-bots-<版>/infra
infra/incus/create-project.sh --help
```

### 4.2 Proxmox（API token）

custom だけ。画面は URL、API token の id と secret、サーバ証明書の指紋、使う node / pool などを受ける。詳細（どの値が要るか、権限の閉じ込め）は spike の結果で決める（§10）。

### 4.3 managed との違い

- custom の VM ホストは修復・更新できない。check の問題の直し方は管理者に渡すコマンドか文（§5.2 の `ProblemFix`）。
- managed は問題の直し方に「修復を実行」（同じ site でジョブをもう一度）を出せる。

## 5. コントラクト

型は実装の指針。名前は実装時に詰めてよいが、判別の形（どの union をどのフィールドで分けるか）は変えない。

### 5.1 保存形式 v3（dsh-bot-vm の `<stateDir>/endpoint.json`）

```ts
type StoredPlacement =
  | { readonly version: 3; readonly backend: StoredIncus; readonly origin: StoredOrigin }
  | {
      readonly version: 3
      readonly backend: StoredProxmox
      readonly origin: { readonly kind: "custom" }
    }

interface StoredIncus {
  readonly kind: "incus"
  readonly url: string
  readonly serverCertificateSha256: string
  readonly clientCertificate: string
  readonly project: string
}

interface StoredProxmox {
  readonly kind: "proxmox"
  readonly url: string
  readonly serverCertificateSha256: string
  readonly tokenId: string
  readonly node: string
  readonly pool: string
  readonly storage: string
  readonly bridge: string
  readonly sshSource: string
  readonly nameservers: readonly string[]
}

type StoredOrigin =
  | { readonly kind: "custom" }
  | {
      readonly kind: "managed"
      readonly site: StoredSite
      readonly setup: {
        readonly jobId: string
        readonly completedAt: number
        readonly bundleSha256: string
      }
    }

type StoredSite =
  | { readonly kind: "this-machine" }
  | {
      readonly kind: "ssh"
      readonly host: string
      readonly port: number
      readonly user: string
      readonly hostKey: string
      readonly identity: "kept" | "removed"
    }
```

- `StoredProxmox` のフィールドは段階 7 で決めた（§10.2）。`url` はポートを省くと `:8006` を補う。
- 秘密は入れない。Incus の秘密鍵は今の credential store の `<scope>/incus-client`、Proxmox の token の secret は `<scope>/proxmox-token`（§6.5）。
- `hostKey` は known_hosts の 1 行（`<type> <base64>`）。`bundleSha256` は構築に使った host-setup の束の sha256（§5.5）で、プラグインの束と違えば画面が「更新があります」を出す（自動で root の処理はしない）。
- 読み書きは今の `EndpointStore` を `PlacementStore` に置き換える。version 2 の読み方は移行のモジュール（§8）だけが持つ。

### 5.2 bot-core の契約（`shared/environment-host.ts`、`contract.ts`）

```ts
type VmBackendKind = "incus" | "proxmox"

type HostSiteView =
  | { readonly kind: "this-machine" }
  | {
      readonly kind: "ssh"
      readonly host: string
      readonly port: number
      readonly user: string
      readonly hostKey: PinnedHostKey
      readonly identity: "kept" | "removed"
    }

type HostOriginView =
  | { readonly kind: "custom" }
  | {
      readonly kind: "managed"
      readonly site: HostSiteView
      readonly completedAt: number
      readonly update: "current" | "available"
    }

type BackendPlacementView =
  | {
      readonly kind: "incus"
      readonly url: string
      readonly project: string
      readonly serverFingerprint: string
      readonly clientFingerprint: string
    }
  | {
      readonly kind: "proxmox"
      readonly url: string
      readonly node: string
      readonly pool: string
      readonly storage: string
      readonly bridge: string
      readonly tokenId: string
      readonly serverFingerprint: string
      readonly sshSource: string
      readonly nameservers: readonly string[]
    }

type LegacyPlacementView = {
  readonly kind: "incus-socket"
  readonly socket: string
  readonly project: string
}

type EnvironmentHostPlacement =
  | { readonly kind: "reading" }
  | { readonly kind: "none" }
  | { readonly kind: "migration-required"; readonly from: LegacyPlacementView }
  | {
      readonly kind: "placed"
      readonly backend: BackendPlacementView
      readonly origin: HostOriginView
    }
  | { readonly kind: "unreadable"; readonly problem: EnvironmentHostProblem }

const PLACEMENT_PROBLEM_CODES = [
  "stored-unreadable",
  "placement-none",
  "migration-required",
  "secret-missing",
] as const

const INCUS_PROBLEM_CODES = [
  "project-default",
  "unreachable",
  "untrusted",
  "incus-too-old",
  "no-vm-driver",
  "project-missing",
  "project-unrestricted",
  "pool-undeclared",
  "pool-unusable",
  "network-undeclared",
  "network-unusable",
  "profile-foreign-device",
] as const

const PROXMOX_PROBLEM_CODES = [
  "unreachable",
  "untrusted",
  "token-rejected",
  "version-too-old",
  "node-missing",
  "privilege-missing",
  "pool-missing",
  "pool-limits-undeclared",
  "storage-missing",
  "storage-unusable",
  "bridge-missing",
  "bridge-denied",
  "guest-unreachable",
] as const

type ProblemFix =
  | { readonly kind: "command"; readonly text: string }
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "repair" }
  | { readonly kind: "choose-host" }

type EnvironmentHostProblem =
  | {
      readonly scope: "placement"
      readonly code: (typeof PLACEMENT_PROBLEM_CODES)[number]
      readonly message: string
      readonly fix: ProblemFix
    }
  | {
      readonly scope: "incus"
      readonly code: (typeof INCUS_PROBLEM_CODES)[number]
      readonly message: string
      readonly fix: ProblemFix
    }
  | {
      readonly scope: "proxmox"
      readonly code: (typeof PROXMOX_PROBLEM_CODES)[number]
      readonly message: string
      readonly fix: ProblemFix
    }

interface EnvironmentHostView {
  readonly placement: EnvironmentHostPlacement
  readonly check: EnvironmentHostCheck
  readonly egress: readonly EnvironmentEgressReport[]
  readonly released: readonly EnvironmentHostRelease[]
  readonly setup?: SetupJobView
  readonly image?: BotEnvironmentImageView
}

interface BotEnvironmentHost {
  view(): EnvironmentHostView
  subscribe(listener: () => void): () => void
  check(signal?: AbortSignal): Promise<EnvironmentHostView>
  readonly setup: VmHostSetup
  readonly custom: VmHostCustom
  forget(): Promise<EnvironmentHostView>
  readonly image?: BotEnvironmentImageHost
}

interface VmHostSetup {
  identity(): Promise<SshIdentityView>
  removeIdentity(scope: "remote-and-local" | "local"): Promise<SshIdentityView>
  scanHostKey(target: SshTarget, signal?: AbortSignal): Promise<HostKeyScan>
  inspect(request: SetupInspectRequest, signal?: AbortSignal): Promise<SetupInspection>
  start(request: SetupStartRequest): SetupJobView
  cancel(jobId: string): SetupJobView
  dismiss(jobId: string): void
  brief(jobId: string): Promise<SetupBrief>
}

interface VmHostCustom {
  preview(credential: CustomCredential, signal?: AbortSignal): Promise<CustomPreview>
  connect(request: CustomConnectRequest, signal?: AbortSignal): Promise<EnvironmentHostView>
}

type CustomCredential =
  | { readonly backend: "incus"; readonly trustToken: string }
  | { readonly backend: "proxmox"; readonly url: string }

type CustomPreview =
  | ({ readonly backend: "incus" } & TrustTokenPreview)
  | {
      readonly backend: "proxmox"
      readonly url: string
      readonly serverFingerprint: string
      readonly sourceAddress: string
    }

type CustomConnectRequest =
  | {
      readonly backend: "incus"
      readonly token: string
      readonly url: string
      readonly project: string
    }
  | {
      readonly backend: "proxmox"
      readonly url: string
      readonly tokenId: string
      readonly tokenSecret: string
      readonly serverFingerprint: string
      readonly node: string
      readonly pool: string
      readonly storage: string
      readonly bridge: string
      readonly sshSource: string
      readonly nameservers: readonly string[]
    }
```

- 今の `useLocal` と `setProject` は無くす。このマシンは managed のジョブで、project は構築か接続のときに決める（変えるときは選び直す）。
- `EnvironmentHostCheck` の `declaration` は backend ごとの判別共用体にする（Incus は今の pool / network / egressAcl、Proxmox は spike で決める）。
- `ProblemFix` の `repair` は origin が managed のときだけ使う。managed で `unreachable` などになったら、custom 向けの「管理者に頼む」ではなく修復を出す。
- Remote（`botEnvironmentHost`）は上のメソッドをそのまま並べ、加えて `investigateSetup(jobId): { sessionId }`（§7）を持つ。`BotEnvironmentHostState` は `EnvironmentHostSettingsView` に `setup` が増えるだけ。段階 2 の Remote は `custom` の 2 つを `previewCustom(credential)` と `connectCustom(request)` として並べ、今の `previewToken` / `pair` / `useLocal` / `setProject` を消した。段階 4 で `setup` を `setupIdentity()`、`removeSetupIdentity(scope)`、`scanHostKey(target)`、`inspectSetup(request)`、`startSetup(request)`、`cancelSetup(jobId)`、`dismissSetup(jobId)` として足した（`brief` は Remote に出さず、段階 5 の `investigateSetup` だけが使う。`start` / `cancel` / `dismiss` は他の変更と同じく `BotEnvironmentHostState` を返す）。引数は `host/environment-host/input.ts` が Host に渡す前に形を確かめる（sudo のパスワードは trim せず、1 行で 1024 文字まで）。`BotEnvironmentHostState` の ready には `pluginVersion` も足した（判断: §4.1 の create-project.sh のコマンドの版。bot-core の版は `DSH_BOTS_VERSION` と同じ）。画面の判断: SSH の修復・再実行は固定済みの `hostKey` でそのまま始める（scan し直さない）。再実行の HTTPS のポートは placement の URL のポート、placement が無ければ既定の 8443（`SetupJobView` はポートを持たない）。SSH 鍵の「消す…」はまず `remote-and-local`、それが失敗したら同じ行に「ここだけ消す…」（`local`）を出す。
- 段階 2 では `setup` の Host 側（`VmHostSetup`）は型だけで、どのメソッドも「この版では使えない」で失敗した。段階 3b で `brief` 以外を実装した（`brief` は段階 5）。段階 3b で契約を 2 つ改めた: `inspect` は `SetupInspectRequest`（site と HTTPS のポート。preflight の `port` の検査に要る。画面でポートを変えたら検査し直す）を受け、`HostSiteView` の ssh は指紋の文字列の代わりに固定した鍵 `hostKey: PinnedHostKey` を持つ。`custom` の proxmox の枝も同じ（段階 7）。setup 系の型は `shared/vm-host-setup.ts` に置いた（§5.6 の型と `SetupBrief`）。
- 段階 5 で `brief` を実装し、`Promise<SetupBrief>` に改めた（判断: 資料のファイル（§7.2）を書いてから返すため）。`brief` は状態が `failed` か `interrupted` で failure のあるジョブだけを受け、それ以外は `SetupRequestError`（`job-not-failed`）。Remote の `investigateSetup(jobId)` は `SetupInvestigation`（`{ sessionId }`、`shared/vm-host-setup.ts`）を返す。セッションを作る処理は `index.ts` が `createEnvironmentHostPanel` の `investigate(brief)` として渡す（design rule 1）。
- 段階 2 の `EnvironmentHostDeclaration` の proxmox の枝は仮に `{ kind: "proxmox", node, pool }`。段階 7 で `{ kind: "proxmox", node, pool, storage, bridge, limits: { cpus, memoryMiB } }`（`ProxmoxPoolLimits`、プールの comment の申告、§10.8）にした。
- 段階 7 で `custom.preview` を `Promise` にした（判断: Proxmox は証明書を取りにつなぐので同期では返せない。Remote の `previewCustom` はもとから `Promise`）。proxmox の `CustomCredential` は URL だけで、`CustomPreview` はサーバ証明書の sha256 と、DSH ホストがその API につないだときの送り元のアドレス（`sourceAddress`、画面の「このインストールのアドレス」の既定値、§10.6）を返す。token はまだ受けない（証明書を確かめてから secret を渡すため）。`BotEnvironmentImageView` の `project` は `place`（Incus は project、Proxmox は `<pool>@<node>`）に改めた。
- 画面の問題の見出しの鍵は `problem.<scope>.<code>`（`unreachable` などが Incus と Proxmox で重なるため）。

### 5.3 VmBackend（dsh-bot-vm の中の境界）

今の `IncusClient` を直に呼んでいた環境の処理（`environment.ts`、`capacity.ts`、`workspace-volume.ts`、`image/`、`guest-transport.ts`）を、backend ごとの実装の上に載せる。段階 2 で実装した形（`src/host/backend/contract.ts`）:

```ts
interface VmBackend {
  readonly kind: VmBackendKind
  readonly where: string
  readonly workspaceDevice: string
  check(signal?: AbortSignal): Promise<BackendCheck>
  capacity(request: CapacityRequest, signal?: AbortSignal): Promise<BotEnvironmentCapacity>
  readonly instances: InstanceBackend
  readonly workspaces: WorkspaceBackend
  readonly images: ImageBackend
  readonly guest: GuestRoute
}

interface InstanceBackend {
  list(owner: string, signal?: AbortSignal): Promise<readonly InstanceRecord[]>
  get(name: string, signal?: AbortSignal): Promise<InstanceRecord | undefined>
  create(spec: InstanceSpec, signal?: AbortSignal): Promise<void>
  change(shape: InstanceShape, signal?: AbortSignal): Promise<InstanceChange>
  conform(shape: InstanceShape, signal?: AbortSignal): Promise<void>
  start(name: string, signal?: AbortSignal): Promise<void>
  settle(name: string, signal?: AbortSignal): Promise<void>
  stop(name: string, signal?: AbortSignal): Promise<void>
  remove(name: string, signal?: AbortSignal): Promise<void>
  markOrphaned(name: string, since: string | undefined, signal?: AbortSignal): Promise<void>
}

interface InstanceShape {
  readonly name: string
  readonly resources: InstanceResources
  readonly workspace: string
}

interface InstanceSpec extends InstanceShape {
  readonly botId: string
  readonly owner: string
  readonly description: string
  readonly image: string
  readonly userData: string
}

interface InstanceResources {
  readonly cpus: number
  readonly memoryMiB: number
  readonly rootDiskGiB: number
}

type InstanceChange =
  | { readonly kind: "none" }
  | { readonly kind: "live"; readonly what: readonly string[] }
  | { readonly kind: "restart"; readonly what: readonly string[] }

interface WorkspaceBackend {
  list(owner: string, signal?: AbortSignal): Promise<readonly WorkspaceRecord[]>
  get(name: string, signal?: AbortSignal): Promise<WorkspaceRecord | undefined>
  create(spec: WorkspaceSpec, signal?: AbortSignal): Promise<void>
  grow(name: string, sizeGiB: number, signal?: AbortSignal): Promise<void>
  markOrphaned(name: string, since: string | undefined, signal?: AbortSignal): Promise<void>
  remove(name: string, signal?: AbortSignal): Promise<void>
}

interface ImageBackend {
  target(alias: string, signal?: AbortSignal): Promise<string | undefined>
  has(fingerprint: string, signal?: AbortSignal): Promise<boolean>
  upload(source: ImageSource, signal?: AbortSignal): Promise<string>
  discard(fingerprint: string, signal?: AbortSignal): Promise<void>
  point(alias: string, fingerprint: string, signal?: AbortSignal): Promise<string | undefined>
}

interface ImageSource {
  readonly fingerprint: string
  readonly bytes: number
  readonly body: AsyncIterable<Uint8Array>
}

interface GuestRoute {
  readonly sshd: "inetd" | "listening"
  open(instance: string, signal?: AbortSignal): Promise<GuestChannel>
}

type BackendCheck =
  | { readonly ok: true; readonly declaration: EnvironmentHostDeclaration }
  | { readonly ok: false; readonly problems: readonly EnvironmentHostProblem[] }
```

- 記録（`InstanceRecord`、`WorkspaceRecord`）は backend に依らない形（名前、`botId` / `owner` / `orphanedSince` の札、状態、CPU とメモリ、ボリュームの大きさと使われているか）。どれを自分のものとみなすか、孤児の印と猶予、大きさの計画（`volumePlan`）は環境の側だけが持つ。
- `change` は今の VM と望む形の差（変えない / 動いたまま変える / 止めて変える）を返し、`conform` がそれを書く。止めるかどうか（動いている VM で `restart` か、ボリュームを広げるとき）は環境が決める。最初の案の `resize(name, resources)` から改めた（判断: 差の判定は backend の書き方に依るので backend が持ち、止める順番は backend に依らないので環境が持つ）。
- `ImageBackend` は最初の案の `presence` / `import` を、取り込みの段（`image/importer.ts`。ダウンロード、検証、再開は backend に依らない）が使う細かい操作に分けた。`upload` の期限は backend の設定（Incus は `imageUploadTimeoutMs`）。
- `GuestRoute.open` はゲストの `sshd -i` につながる双方向のバイト列（`GuestChannel`: `input`、`output`、`diagnostics`、`close`）。Incus は今の exec の websocket（incus-endpoint.md §5.2）。DSH のプロセスの中の中継（`run/guest.sock`）と ProxyCommand は backend に依らず 1 つ。
- `userData` は cloud-init の user-data。Incus は `cloud-init.user-data`。`workspaceDevice` はゲストから見たワークスペースのディスクのパス（Incus は `/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_workspace`）。Proxmox での渡し方は spike（§10）。
- 外向きの実測（`egress-probe.ts`）は今もゲストの SSH で短いコマンドを 1 つ実行するだけで、backend に依らない。最初の案の `EgressBackend` は置かない（判断: SSH の経路は `GuestRoute` の上にすでにあり、backend ごとの実装が要らない）。
- `where` は利用者向けの文の中で VM ホストを指す語（Incus は `the Incus project "<project>"`）。
- 段階 7 で足したもの: `settle` は環境が SSH の準備（`boot-finished`）を確かめた直後に呼ぶ「初回の起動にだけ要ったものを捨てる」口（Incus は何もしない。Proxmox は cloud-init の ISO を秘密の無いものに上書きして外す、§10.4）。`GuestRoute.sshd` はゲストの sshd を exec の `sshd -i` で起こすか、TCP で listen させるか（`listening` のとき `cloud-init.ts` が runcmd の先頭に §10.1 の 2 行を足す）。`ImageSource.fingerprint` は manifest の値で、Proxmox はアップロードの前にファイル名を決めるのに使う（返す fingerprint は実際に流したものの sha256 のまま、取り込みの段が照合する）。
- Proxmox の実装は `src/host/backend/proxmox/`（§10.2〜）。
- Incus の実装は `src/host/backend/incus/`（`backend.ts` と、今の `IncusClient`、check、layout、reconfigure、capacity、pairing、trust token）。check はこの宣言（pool / network / egressAcl）を覚え、ボリュームと VM の操作はそれを使う。環境は ensure・remove・capacity・reconcile のたびに `check` を呼び直す。段階 2〜6 は Incus だけで、Proxmox の placement は読めるがつなぐと「この版では使えない」で失敗した。段階 7 で Proxmox を実装した。

### 5.4 HostShell（VM ホストでコマンドを実行する）

```ts
interface HostShell {
  readonly site: HostSiteView
  stage(bundle: HostSetupBundle, signal?: AbortSignal): Promise<StagedBundle>
  run(request: ShellRun, signal?: AbortSignal): ShellProcess
  dispose(): Promise<void>
}

interface HostSetupBundle {
  readonly sha256: string
  readonly files: readonly {
    readonly path: string
    readonly mode: number
    readonly content: Uint8Array
  }[]
}

interface StagedBundle {
  readonly dir: string
  release(): Promise<void>
}

interface ShellRun {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string>>
  readonly privilege: ShellPrivilege
}

type ShellPrivilege =
  | { readonly kind: "user" }
  | { readonly kind: "root"; readonly via: "already-root" }
  | { readonly kind: "root"; readonly via: "sudo"; readonly password: string | undefined }

interface ShellProcess {
  readonly stdout: AsyncIterable<string>
  readonly stderr: AsyncIterable<string>
  control(line: "cancel"): void
  readonly exit: Promise<{
    readonly code: number | null
    readonly signal: string | null
    readonly broken?: { readonly code: "ssh-failed" | "host-key-changed"; readonly message: string }
  }>
}
```

- 実装は 2 つ: `localShell`（`child_process.spawn`、シェルを通さない）と `sshShell`（`ssh -F <stateDir>/setup/ssh/config -T dsh-bots-vm-host -- <argv をシェル用に引用した 1 行>`）。手順（`SetupRunner`）は HostShell しか知らず、local と remote で同じ。
- root: `sudo -S -p '' -- env <env> <argv>`。パスワードがあれば stdin の 1 行目に書く。パスワードが要らなければ `sudo -n`。`already-root` は sudo を通さない。
- stdin はパスワードの後は制御の行だけを運ぶ。`cancel` を書くと host-setup.sh は今のコマンドが終わったところで止まる。stdin の EOF（DSH が止まった、SSH が切れた）も取り消しとして扱う（§5.5）。根拠: 誰も見ていない root の処理を残さないため。
- `hello` イベント（§5.5）を受けるまで stdin にパスワードの他は何も書かない。sudo がパスワードを拒むと stdin からもう一度読もうとする（推測: sudo の `-S` の振る舞い）ので、stderr の `Sorry, try again` か 10 秒以内に hello が無いことで失敗 `sudo-rejected` にしてプロセスを止める。
- `stage`: local はプラグインの `lib/host-setup/`（読み取りだけ）をそのまま使う。ssh は `mktemp -d`（0700、接頭辞 `dsh-bots-host-setup.`）に tar を stdin で送り、`sha256sum` で束を確かめ、ジョブの終わりに消す。使っている間は別の SSH のプロセスが `flock -s <dir>/.in-use` を持ち続ける（DSH が止まれば SSH が切れて外れる）。stage のはじめに、同じ接頭辞で自分の所有の、10 分より古く、`flock -n -x` が取れる（使われていない）ものを消す（DSH が途中で止まったときの残り）。
- 実装（段階 3b）: `src/node/setup-shell.ts`。スクリプトは実行ビットに頼らず `bash <dir>/vm/host-setup.sh` で起こす（パッケージの展開で mode が落ちても動くように）。ssh の終了コード 255 は `exit.broken` で返し、stderr の `REMOTE HOST IDENTIFICATION HAS CHANGED` / `Host key verification failed` を `host-key-changed`、それ以外を `ssh-failed` にする。取り消し以外でプロセスを止める（`sudo-rejected`、`protocol`）ときは signal で SIGTERM を送り、DSH のプラグインが止まるときは `cancel` の行だけを送る（apt を途中で切らない）。

### 5.5 host-setup.sh の構造化出力

host-setup.sh は今のとおり root で非対話・冪等に動く単体のスクリプトで、人が直接使ってもよい（出力は今と同じ）。`--events` を付けると次の契約で動く。

- 呼び方: `host-setup.sh --events <phase>...`。phase は `preflight`（root 不要）、`packages`、`incus`、`firewall`、`https`、`token`、`all`（= packages incus firewall）。今の `local` は無くし、`remote` は `https` と `token` に分ける。root の検査はスクリプトの頭からフェーズごとに移す（root の要るフェーズが一般ユーザで走ると、そのフェーズの `phase-failed`（`not-root`）で止まる）。
- 設定は今と同じ環境変数（`POOL`、`POOL_SIZE`、`PROJECT`、`NET`、`NET_CIDR`、`ACL`、`CLIENT_NAME`、`DSH_BOTS_THIRD_PARTY`）に、`HTTPS_PORT=<port>`（既定 8443。今の `HTTPS_ADDRESS` の代わり。preflight の `port` と、未設定のときに https が設定するアドレスのポート）、`HTTPS_SCOPE=loopback|all`（§3.7。既定 `all`。loopback は未設定なら `127.0.0.1:<port>` にし、ufw / firewalld に触らない。all は `:<port>` にし、ポートを開ける）、`REPLACE_CLIENT=<fingerprint>`（12〜64 桁の 16 進。token の前に、前の自分の証明書を trust から外す。無ければ何もしない）、`OWNER=<owner>`（16〜64 桁の 16 進、`<stateDir>/owner`。§3.5 の project の衝突の判定。インスタンスと custom ボリュームの `user.dsh-bot.owner` を見る。空なら判定しない）を足す。
- 引数・設定の誤り（知らない phase、phase が無い、上の値の形の違い）はイベントを出さずに終了コード 2 と stderr の usage で終わる（プラグインには `end` の前の終了、つまり `protocol`）。プラグインの誤りなので画面の失敗の種類にはしない。
- stdout はイベントだけ。1 行に 1 つの JSON オブジェクト（UTF-8）。コマンドの出力はすべて stderr（ログ）に回す（`exec 3>&1 1>&2` でイベントを fd 3 に書く）。SSH 越しでも stdout と stderr が分かれるので同じ形で届く。
- stdin: 1 行目はスクリプトに来ない（sudo が読む）。以降は制御の行。`cancel` か EOF で、今のフェーズの今のコマンドが終わったところで止まり、`phase-failed`（code `cancelled`）と `end` を出す。知らない行は読み捨てる。実装: `--events` のときだけ、stdin を読む子プロセスが `cancel` か EOF で親に `SIGUSR1` を送り、親の trap が `fail cancelled` を呼ぶ（bash は前景のコマンドが終わってから trap を実行する。確認済み: テストで apt-get の偽物を止めている間に cancel / EOF を送り、apt-get が終わってから `cancelled` が出て次のコマンドが走らないこと）。スクリプトの中のコマンドの stdin は `/dev/null` にする（制御の行を apt などに読ませない）。フェーズとフェーズの間に来たら、次のフェーズの `phase-start` の直後に `cancelled` で止まる。
- 出る順: `hello` → フェーズごとに `phase-start` →（`check` / `fact` / `token`）→ `phase-done` か `phase-failed` → `end`。`phase-failed` の後は `end`（`ok: false`）で終わり、残りのフェーズは走らない。preflight は検査が `failed` でもフェーズとしては `phase-done`（`changed: false`）で、可否はプラグインが check から決める（§5.6 の verdict）。

```ts
type HostSetupPhase = "preflight" | "packages" | "incus" | "firewall" | "https" | "token"

type HostSetupEvent =
  | { readonly v: 1; readonly type: "hello"; readonly version: string; readonly uid: number }
  | {
      readonly v: 1
      readonly type: "check"
      readonly id: PreflightCheckId
      readonly state: "ok" | "warning" | "failed"
      readonly value: string
      readonly code?: PreflightCheckCode
      readonly what?: string
      readonly fix?: string
    }
  | { readonly v: 1; readonly type: "phase-start"; readonly phase: HostSetupPhase }
  | {
      readonly v: 1
      readonly type: "phase-done"
      readonly phase: HostSetupPhase
      readonly changed: boolean
      readonly note?: string
    }
  | {
      readonly v: 1
      readonly type: "phase-failed"
      readonly phase: HostSetupPhase
      readonly code: HostSetupFailureCode
      readonly what: string
      readonly fix: string
      readonly command?: string
      readonly location?: string
      readonly exit?: number
    }
  | { readonly v: 1; readonly type: "fact"; readonly key: HostSetupFactKey; readonly value: string }
  | { readonly v: 1; readonly type: "token"; readonly token: string }
  | { readonly v: 1; readonly type: "end"; readonly ok: boolean }

type PreflightCheckCode =
  | "arch-unsupported"
  | "os-unsupported"
  | "os-dsh-host-only"
  | "kvm-missing"
  | "systemd-missing"
  | "disk-low"
  | "sudo-missing"
  | "incus-present"
  | "consent-needed"
  | "port-maybe-incus"
  | "port-in-use"

type PreflightCheckId =
  | "arch"
  | "os"
  | "kvm"
  | "init"
  | "disk"
  | "privilege"
  | "incus"
  | "third-party"
  | "port"

type HostSetupFactKey =
  | "os"
  | "incus-version"
  | "https-address"
  | "server-fingerprint"
  | "project"
  | "pool"
  | "network"
  | "egress-acl"

type HostSetupFailureCode =
  | "not-root"
  | "os-unsupported"
  | "third-party-refused"
  | "zabbly-key-mismatch"
  | "module-missing"
  | "incus-too-old"
  | "no-vm-driver"
  | "project-conflict"
  | "project-in-use"
  | "firewall-drops"
  | "port-in-use"
  | "token-missing"
  | "cancelled"
  | "command-failed"
```

- check の value と code: `arch` は `uname -m`、`os` は PRETTY_NAME、`kvm` は `/dev/kvm` か `absent`、`init` は `systemd` か `other`、`disk` は `<n> GiB free`、`privilege` は `root` / `sudo-without-password` / `sudo-with-password` / `none`（SetupInspection の privilege にそのまま写す）、`incus` は `incus --version` か `absent`、`third-party` は `zabbly` か `none`、`port` は HTTPS_PORT。code は ok 以外のときだけ。`os-dsh-host-only`（NixOS / Arch / WSL / RHEL 系）は suggestion `another-machine` に、`consent-needed` は ConsentNeed（zabbly）に写す。`port` は一般ユーザには listen しているプロセスがわからない（`ss -p` は他のユーザのものを示さない）ので、Incus が入っていてポートが使われていれば `warning`（`port-maybe-incus`）、入っていなければ `failed`（`port-in-use`）。https のフェーズは未設定のときだけ `ss` を見直し、使われていれば `port-in-use` で止まる。
- 今の `fail <what> <fix>` に code を足して `fail <code> <what> <fix>` にする。ERR trap（`on_error`）は `command-failed` で、`command`（`$BASH_COMMAND`）、`location`（ファイルと行）、`exit` を入れる。what / fix は英語の文のまま（画面は code から日本語・英語の見出しを作り、what / fix をそのまま添える）。
- `changed`: 変える関数（`apt_install` で何か入れた、`incus … create` した、設定を書き換えた）が立てる旗（`mark_changed`）。Incus の資源は `incus … show` の前後を比べる（`objects.sh` の ensure_*）。ufw は `ufw status` の前後、systemd のユニットは `is-enabled` / `is-active`、書くファイルは中身を比べる。`token` は毎回 token を出すので常に `changed: true`。
- `HostSetupFailureCode` のうち、`fail` を呼ぶのは `objects.sh` と `create-project.sh` も同じ（`project-conflict`、`token-missing` など）。`create-project.sh` と作者用のスクリプトは `--events` を持たないが、`fail` の形を揃えるため code を付ける（`usage`、`tool-missing`、`unreachable` など、HostSetupFailureCode の外。イベントにならないので契約には入れない）。
- テスト（`test/host-setup.test.ts`）: vitest が host-setup.sh を bash で実行し、stdout のすべての行を JSON として読んでイベントを確かめる。root と Incus の要るところは、PATH を偽のコマンド（`test/fixtures/host-setup/fake-host.mjs`。incus、apt-get、systemctl、ufw、ss、id など。状態は JSON のファイル）と許した実物だけにし、ファイルは `DSH_BOTS_SYSROOT`（テスト用の根。`/etc/os-release`、`/dev/kvm`、`/run/systemd/system`、`/var/lib`、`/sys/module`、書くファイル）の下に置く。
- `token` は秘密。プラグインはこの行をログに書かず、受けたらすぐペアリングに使い、保存しない。stderr に token が出ないことを host-setup.sh が守る（今の `DSH_BOTS_TOKEN_FILE` の考えと同じ）。
- JSON の文字列はスクリプトの中の 1 つの関数で作る（`\`、`"`、制御文字を escape）。jq には頼らない。
- 契約の検査（プラグイン側）: 知らない `type`・`v`、JSON でない行、`end` の前の終了は失敗 `protocol`（fail closed）。
- `https` は `incus query /1.0` の `certificate_fingerprint`（64 桁）を fact `server-fingerprint` にする。読めなければ `command-failed` で止まる（空の値を返さない）。
- 確認済み（2026-11-27、段階 3a）: 使い捨ての Debian 13 の VM（入れ子の KVM）で、一般ユーザの `--events preflight`（すべて ok、`sudo-with-password`）、`sudo -S` で 1 回だけパスワードを渡した `HTTPS_SCOPE=loopback OWNER=… --events all https token`（packages・incus・https が changed、`core.https_address=127.0.0.1:8443`、token は stderr に出ない）、2 回目で token 以外がすべて `changed: false`、その token で `incus remote add` して project `dsh-bots` だけが見えること、`REPLACE_CLIENT` で前の証明書が trust から消えること、sudo 越しの stdin の EOF で `cancelled` になること、install.sh の remote / local が今の形のまま最後まで通ること。未検証: Debian 12 / Ubuntu 24.04（Zabbly）と Fedora の実機（偽のコマンドのテストだけ）、ufw / firewalld / Docker の実機、apt の実際の途中での取り消し（偽の apt-get では確認済み）。
- 束（`HostSetupBundle`）: `infra/vm/host-setup.sh`、`infra/vm/lib.sh`、`infra/incus/objects.sh`、`infra/release.env` を build が `packages/dsh-bot-vm/lib/host-setup/` に写し、sha256 を出す。元は infra/ だけ（写しを手で直さない）。テストで「写しと元が同じ」「束に要るファイルが揃う」を保つ。
  - 実装（段階 3b）: `scripts/host-setup-bundle.mjs`（`pnpm build` の最後）。`infra/` の下の相対の配置のまま写し（`vm/host-setup.sh`、`vm/lib.sh`、`incus/objects.sh`、`release.env`。スクリプトが `$HERE/../incus/objects.sh` などを読むため）、`bundle.json`（`{ version: 1, sha256, files: [{ path, mode, sha256 }] }`）を書く。束の sha256 は `<mode 8 進 4 桁> <ファイルの sha256> <path>\n` を path の順に並べた文字列の sha256。プラグインは使うときに束を読み、ファイルごとと全体の sha256 を確かめる（違えば「入れ直してください」で inspect / start が失敗する）。束が読めないとき `update` は `available` を返す。

### 5.6 SetupJob

```ts
type SetupSite =
  | { readonly kind: "this-machine" }
  | { readonly kind: "ssh"; readonly target: SshTarget; readonly hostKey: PinnedHostKey }

interface SshTarget {
  readonly host: string
  readonly port: number
  readonly user: string
}

interface PinnedHostKey {
  readonly type: string
  readonly fingerprint: string
}

interface HostKeyScan {
  readonly target: SshTarget
  readonly keys: readonly PinnedHostKey[]
}

interface SshIdentityView {
  readonly state: "absent" | "present"
  readonly authorizedKeysLine?: string
  readonly fingerprint?: string
}

interface PreflightCheck {
  readonly id: PreflightCheckId
  readonly state: "ok" | "warning" | "failed"
  readonly value?: string
  readonly what?: string
  readonly fix?: string
}

type ConsentNeed = {
  readonly kind: "third-party-repository"
  readonly id: "zabbly"
  readonly url: string
  readonly signingKey: string
}

type SetupInspection =
  | {
      readonly id: string
      readonly at: number
      readonly site: HostSiteView
      readonly checks: readonly PreflightCheck[]
      readonly verdict: "ready"
      readonly privilege: "root" | "sudo-without-password" | "sudo-with-password"
      readonly consents: readonly ConsentNeed[]
    }
  | {
      readonly id: string
      readonly at: number
      readonly site: HostSiteView
      readonly checks: readonly PreflightCheck[]
      readonly verdict: "refused"
      readonly suggestion?: "another-machine"
    }

interface SetupInspectRequest {
  readonly site: SetupSite
  readonly httpsPort: number
}

interface SetupStartRequest {
  readonly inspectionId: string
  readonly project: string
  readonly httpsPort: number
  readonly sudoPassword?: string
  readonly consents: readonly ConsentNeed["id"][]
  readonly identityAfter?: "keep" | "remove"
}

type SetupStepId = "packages" | "incus" | "firewall" | "connect" | "image"
type SetupStepState = "pending" | "running" | "done" | "skipped" | "failed"

interface SetupStepView {
  readonly id: SetupStepId
  readonly state: SetupStepState
  readonly note?: string
  readonly startedAt?: number
  readonly endedAt?: number
}

type SetupJobState = "running" | "cancelling" | "succeeded" | "failed" | "cancelled" | "interrupted"

interface SetupLogLine {
  readonly at: number
  readonly source: "host" | "plugin"
  readonly text: string
}

type SetupFailureCode =
  | HostSetupFailureCode
  | "sudo-rejected"
  | "ssh-failed"
  | "host-key-changed"
  | "staging-failed"
  | "protocol"
  | "endpoint-unreachable"
  | "pairing-failed"
  | "check-failed"
  | "image-failed"
  | "interrupted"

interface SetupFailure {
  readonly step: SetupStepId
  readonly code: SetupFailureCode
  readonly what: string
  readonly fix: string
  readonly command?: string
  readonly location?: string
  readonly exitCode?: number
  readonly logTail: readonly string[]
}

interface SetupJobView {
  readonly id: string
  readonly attempt: number
  readonly site: HostSiteView
  readonly project: string
  readonly state: SetupJobState
  readonly steps: readonly SetupStepView[]
  readonly startedAt: number
  readonly endedAt?: number
  readonly log: { readonly tail: readonly SetupLogLine[]; readonly lines: number }
  readonly failure?: SetupFailure
}
```

- 状態とロジックを分ける: `reduceSetupJob(job, input): SetupJob`（純粋。入力は HostSetupEvent、プラグインの段の始まり・終わり・失敗、取り消しの要求、プロセスの終了）と、HostShell とストアをつなぐ `SetupRunner`（IO だけ）に分ける。イベントからステップへの写し（§3.6 の表）は reduce の中だけにある。
- 永続化: `<stateDir>/setup/jobs/<id>/job.json`（SetupJobView から log.tail を除いたもの、0600）と `log.txt`（マスク済み、0600、2 MiB で頭を切る）。書くのはステップの変化ごと。リロードでは Remote の watch が今の job.json を返す。DSH の再起動で `running` / `cancelling` のまま見つかったジョブは `interrupted`（failure の step は走っていたステップ）にする。
- 再実行か新規かは Host が決める（`SetupStartRequest` に jobId は無い）: 同じ site（このマシン、または同じ user・host・port）の最後のジョブが失敗・取り消し・中断で、project も同じなら、その続きとして同じ jobId で再実行する（手順は冪等なので）。そうでなければ新しいジョブにする。
- 再実行: 同じ ID のジョブの `attempt` を 1 つ増やし、ステップをすべて pending に戻す。済んだフェーズは `changed: false` で skipped になる。sudo のパスワードは改めて受ける（§6.1）。事前検査は再実行の前にもう一度行い、`inspectionId` は最新のものだけを受け付ける。
- 残すのは最後の 5 つのジョブ。`dismiss` は終わったジョブを画面から外す（ファイルは 5 つの枠で消える）。
- 同時に 1 つ: `start` は走っているジョブがあれば `setup-busy` で拒む。
- 実装（段階 3b）: `src/host/setup/`（`events.ts` の parse、`preflight.ts`、`job.ts` の `reduceSetupJob`、`runner.ts`、`store.ts`、`setup.ts`）。`start` の拒否は `SetupRequestError`（`code`: `setup-loading`、`setup-busy`、`inspection-stale`、`request-invalid`、`job-unknown`、`job-running`、`identity-missing`、`identity-unauthorized`）。job.json は SetupJob（view の項目に加えて、再実行に要る target（site と固定したホスト鍵、project、ポート、同意、鍵の扱い）、fact、`dismissed`）。最新の検査は 1 つだけ覚え、`start` で使い切る。ポートが検査のときと違えば `inspection-stale`。このマシンが `migration-required` のときは移行元の project でしか始められない。

### 5.7 SetupBrief（セッションの初めのメッセージ）

```ts
interface SetupBrief {
  readonly title: string
  readonly cwd: string
  readonly message: string
}
```

中身は §7。dsh-bot-vm が作り、bot-core がセッションを作る。

## 6. セキュリティ

### 6.1 sudo のパスワード

- 画面の欄（`type=password`）で受け、Remote の `setup.start` の引数で Host に届く。Host はジョブの 1 回の root のプロセスの stdin に 1 度だけ書き、参照を捨てる。
- 保存しない（job.json、log.txt、placement、credential store のどれにも入れない）。ログに出さない。念のため、ログに書く前にパスワードと同じ文字列を `[redacted]` に置き換える（マスクの対象は他に token、§6.5）。
- 1 回の sudo で root のフェーズをすべて走らせる。sudo の timestamp は tty か親プロセスに結び付き（推測: sudoers(5) の `timestamp_type`）、SSH のコマンドごとに親が変わるので、フェーズごとに sudo を呼ぶとそのたびにパスワードが要る。
- 再実行のたびに受け直す。ジョブはパスワードを持たない。
- Remote の引数が DSH の gateway のログに残るかは未検証。残るなら、パスワードを運ぶ専用の短命の受け口（1 回で消える id）を設ける（§12）。
- 調べるためのセッション（§7）には渡さない。

### 6.2 SSH の鍵

- プラグイン専用の ed25519 鍵: `ssh-keygen -t ed25519 -N '' -C dsh-bots@<DSH ホスト名> -f <stateDir>/setup/ssh/id_ed25519`。秘密鍵はファイル（0600）。ssh が読むので、ボットの鍵（incus-endpoint.md §6.2）と同じくファイルにする。
- authorized_keys の行は `restrict` 付き（§3.3）。`from=` は付けない（DSH ホストの出口のアドレスがプラグインからはわからない）。
- 構築後の扱いは利用者が選ぶ:
  - 残す（既定）: 修復・更新・調べるためのセッションで使う。`identity: "kept"`。
  - 消す: 成功の後、SSH で authorized_keys から鍵の本体（base64）が一致する行だけを消し（一時ファイルに書いてから置き換える）、手元の鍵を消す。`identity: "removed"`。修復には鍵の作り直しと行の追加がもう一度要る。
- 後から消す: 画面の「SSH 鍵を消す」。遠くの行を先に消し、失敗したら何も消さずに理由と手で消すコマンドを示す。「手元だけ消す」も選べる。
- `<stateDir>/setup/ssh/config` に VM ホストの Host ブロック（`dsh-bots-vm-host`）を 1 つ書く: HostName、Port、User、`IdentityFile`、`IdentitiesOnly yes`、`UserKnownHostsFile <stateDir>/setup/ssh/known_hosts`、`StrictHostKeyChecking yes`、`BatchMode yes`、`ForwardAgent no`、`ClearAllForwardings yes`。`-F` で渡すので利用者の `~/.ssh/config` に左右されない（incus-endpoint.md §5.3 と同じ考え）。
- DSH ホストに要るのは OpenSSH のクライアント（`ssh`、`ssh-keygen`、`ssh-keyscan`）。今も `ssh` は要る。`ssh-keygen` と `ssh-keyscan` は同じパッケージに入る（推測: Debian の openssh-client、NixOS の openssh）。

### 6.3 SSH のホスト鍵

- `ssh-keyscan` は認証の無い取得なので、指紋は利用者が VM ホストで確かめる（§3.3 の 3）。確かめた鍵だけを `known_hosts` に書き、以降は `StrictHostKeyChecking yes`。
- 鍵が変わったら ssh が止まり、ジョブは `host-key-changed` で失敗する。自動で受け入れ直さない。画面は「ホスト鍵を確かめ直す」（§3.3 の 3 をもう一度）を出す。

### 6.4 証明書と権限（このマシンも制限付き）

- このマシンも loopback の HTTPS（`https://127.0.0.1:8443`）と、project に限った制限付き証明書（`restricted: true`、`projects: [<project>]`）にする。incus-endpoint.md §10 の 6（形 1 は Unix ソケット）を改める。
  - 理由: Unix ソケットはサーバ全体（root 相当）の権限で、project への限定がプラグインのコードの正しさだけに頼っていた（incus-endpoint.md §6.1）。制限付き証明書なら Incus が縛る。
  - DSH のユーザを `incus-admin` に入れない。グループを得るための DSH の再起動も要らない。
  - transport は HTTPS の 1 つになり、Unix ソケットの `IncusTransport`、設定 `incusSocket`、`kind: "local"` を消す。
- 確認済み（incus-endpoint.md §11 の 5、2026-11-26）: `core.https_address=127.0.0.1:8443` での制限付き証明書のペアリングと、HTTPS 越しの exec / SSH。spike（§8.1）の数値では exec+HTTPS は exec+ソケットより大きな転送で 1〜5 割遅い（`fs.writeText` 32 MiB で 2674 ms と 1314 ms）。ボットの道具の使い方では問題にならない（推測、incus-endpoint.md §8.1 と同じ判断）。
- managed の root は VM ホストで何でもできるが、使うのは構築の間だけで、プラグインに残るのは制限付き証明書（と、残すなら SSH 鍵、§6.2）。
- managed は自分の古い証明書を外せる（token のフェーズで `REPLACE_CLIENT`、root の `incus config trust remove`）。custom は今と同じく外せない（incus-endpoint.md §4）。

### 6.5 置き場所

| もの                                         | 置き場所                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| sudo のパスワード                            | どこにも置かない（1 回の stdin、§6.1）                                              |
| trust token                                  | どこにも置かない（イベントで受けてすぐ使う。custom では画面の欄から pair の引数へ） |
| Incus のクライアント証明書の秘密鍵           | credential store `<scope>/incus-client`（今と同じ）                                 |
| Proxmox の API token の secret               | credential store `<scope>/proxmox-token`                                            |
| placement（URL、証明書、指紋、origin、site） | `<stateDir>/endpoint.json`（0600、version 3、§5.1）                                 |
| SSH の秘密鍵・公開鍵                         | `<stateDir>/setup/ssh/id_ed25519{,.pub}`（0600 / 0644、ディレクトリ 0700）          |
| SSH の known_hosts と config                 | `<stateDir>/setup/ssh/known_hosts`、`config`（0600）                                |
| ジョブの状態とログ                           | `<stateDir>/setup/jobs/<id>/job.json`、`log.txt`（0600、マスク済み）                |
| 調べるためのセッションの資料                 | `<stateDir>/setup/jobs/<id>/`（セッションの cwd、§7）                               |
| VM ホストに送った束                          | VM ホストの `mktemp -d`（0700）。ジョブの終わりに消す                               |

## 7. 失敗とセッション

失敗の画面（ui-design.md の VM host）に「このエラーをセッションで調べる」を置く。押すと普通の DSH セッションを作り、初めのメッセージで状況を渡し、そのセッションを開く。

### 7.1 作り方（DSH の API）

- 確認済み（型を読んだ）: `@deepseek-ai/dsh-api-session-controller` 0.2.2-rc.5 の `SessionController`（`ctx.sessionController`）に `create(request: SessionCreateRequest)`（`workspaceId` か `cwd` のどちらか、任意で `agentPreset`。省くと既定の preset）、`rename({ sessionId, title })`、`prompt({ requestId, sessionId, mode, content })`（`content` は `{ type: "text", text }` など）がある。bot-core は今もこの 3 つを `index.ts` で使っている（Workspace のセッション、チャネルの prompt）。
- 確認済み（コードを読んだ）: クライアントで `ctx.uiWorkspace.openSession(sessionId)` がセッションを開く（bot-core の `client/wiring/bots-face.ts` など）。
- 使い方: bot-core の `index.ts` が Remote の `botEnvironmentHost.investigateSetup(jobId)` を受け、`environment.host.setup.brief(jobId)` で SetupBrief を得て、`sessionController.create({ cwd: brief.cwd })` → `rename({ title: brief.title })` → `prompt({ mode: "queue", content: [{ type: "text", text: brief.message }] })` を行い、`sessionId` を返す。クライアントはそれを開く。
  - design rule 1（`sessionController.create()` は `host/preset/session.ts` と `index.ts` だけ）の範囲に入る。rule 1 の文（ボットのセッションは Bot.createSession）は「ボットのセッション」についてで、これはボットのセッションではない。docs/design-rules.md の rule 1 の行に「VM ホストの構築を調べるセッション（docs/specs/vm-host-modes.md §7）」を例外の理由として足す。
  - dsh-bot-vm は `sessionController` を使わない（design rule 17）。
- 確認済み（コードを読み、確認用 DSH で動かした。2026-11-27）: `cwd` だけの `create` は `attachSession` を呼ばない（`dsh-api-session-controller` の `create` は `workspaceId` のときだけ attach する。docs/subsystems/workspace.md「sessions created afterwards join a workspace only through attachSession」）。セッションは Workspace に入らず、サイドバーの「グループなし」に並ぶ。ジョブごとに Workspace は増えない（2 つのジョブで調べた後も workspace の storage の `workspaceIds` は空）。cwd は `<stateDir>/setup/jobs/<id>/` のまま。
- 確認済み（同上）: bot-core はこのセッションをボットのものとみなさない。サイドバーはボットの記録（`botSessionIds`）にあるセッションだけを隠し、既定の preset のセッションは `stock` に分ける（`client/session-classification.ts`、`client/hide-sessions.ts`）。画面でも「グループなし」に見えた。
- 注意（確認用 DSH で見た）: DSH の `workspace-write` のサンドボックスは `/tmp` を tmpfs にするので、`stateDir` が `/tmp` の下にあると、セッションの bash から cwd の外（`<stateDir>/setup/ssh/id_ed25519`）が見えず `ssh -F` が使えない。既定の `~/.dsh/bots-vm` では問題にならない（読み取りは制限されない）。

### 7.2 初めのメッセージ

英語で書く（モデル向け。DSH の既定の preset が日本語の利用者に日本語で答えるかはモデル次第）。次を順に入れる。

1. 何をしていたか: 「dsh-bots の VM ホストの構築（managed、Incus）が失敗した。原因を調べ、直し方を提案してほしい」。
2. 対象: site（このマシン、または `user@host:port`）、OS（fact `os`）、Incus の版（あれば）、project。
3. 失敗: ステップ、code、what、fix、コマンド、場所（ファイルと行）、終了コード。
4. ログの末尾（マスク済み、最後の 80 行）と、全体のログのパス（cwd の `log.txt`）。
5. 直し方の候補: code ごとに用意した文（例: `firewall-drops` なら見つかった chain と ufw / firewalld の許可の仕方、`port-in-use` なら `ss -ltnp` で使っているものを調べる）。
6. README の要点: infra/vm/README.md の「What gets set up」と「Network isolation」の要約（プール、ブリッジ、ACL、project、ファイアウォールの扱い、`nftables.service` を有効にしないこと）。束に入れた文書から作る。 判断: 実装は README から作らず、dsh-bot-vm の `src/host/setup/brief.ts` に要約の文を持つ（README を束に入れると束の sha256 が変わり、文書の変更だけで「更新があります」が出るため）。README の「What gets set up」「Network isolation」を変えたら、この要約も直す。
7. 使えるもの:
   - SSH（site が ssh で手元に鍵があるとき）: 「`ssh -F <cwd>/ssh/config dsh-bots-vm-host <command>` で VM ホストに入れる。`~/.ssh/config` を変えないこと」。判断: `<stateDir>/setup/ssh/config` は次に検査する VM ホストへ書き換わる（走っているジョブもそれを使う）ので、ジョブの site を固定した config と known_hosts をセッションの cwd の `ssh/` に別に書く（鍵は `<stateDir>/setup/ssh/id_ed25519` をそのまま指す）。鍵が消されていれば、VM ホストで利用者にコマンドを実行してもらうよう書く。
   - このマシン: そのまま実行できる。
8. 守ること: sudo のパスワードは渡していない。root が要るコマンドは利用者に実行を頼む。ネットワークの ACL、ブリッジの規則、project の制限を弱めない（docs/agent-setup.md の「Never」と同じ）。直したら、設定画面の「もう一度」で続きから進むこと。

cwd（`<stateDir>/setup/jobs/<id>/`）には `log.txt` と、メッセージと同じ `brief.md`、`host-setup/`（プラグインの版の束のスクリプトの写し。失敗の「場所」`host-setup.sh:<行>` を読むため）、SSH のときは `ssh/config` と `ssh/known_hosts` を置く（すべて 0600、ジョブと一緒に 5 つの枠で消える）。メッセージの見出しは英語の Markdown（Target、Failure、Log、Where to look、What the setup makes、Access、Rules）、題は `VM host setup failed: <code> (<host か this machine>)`。

## 8. 移行

### 8.1 version 2 の endpoint.json（local、Unix ソケット）

- 読み続けない。起動時に version 2 の local を見つけたら、placement は `migration-required`（`from`: ソケットと project）で、ボットの ensure は問題 `migration-required`（直し方: 設定画面で移行する）で失敗する。ソケットにはつながない。
- 画面の「移行する」は「このマシンに構築」のジョブを、project を今のもので固定して始める。手順はすべて冪等なので、packages・incus・firewall は skipped になり、実際に変わるのは `core.https_address`（§3.7）と token と証明書（接続）だけのはず（推測）。sudo のパスワードは要る。
- 同じ Incus の同じ project なので、今のボットの VM とワークスペースのボリュームはそのまま使える。owner も同じ（`<stateDir>/owner`）なので、incus の段の衝突の検査（§3.5）は通る。
- 成功で version 3（origin managed、site このマシン）を書き、version 2 のファイルは `endpoint.v2.json` に改名して残す（読まない。手で戻すときのため）。
- `incus-admin` の グループ: 移行は DSH のユーザをグループから外さない（他の用途で使っているかもしれない）。完了の画面に外すコマンド（`sudo gpasswd -d <user> incus-admin`）を示す。
- 何も保存されていない（version 2 のファイルが無く、今の既定でソケットを使っていた）利用者は、placement が `none` になる。今のボットは ensure が `placement-none` で止まる。画面は「VM ホストを選ぶ」を出す。同じ project を選べば VM は引き継がれる。

### 8.2 version 2 の endpoint.json（remote）

- 起動時に 1 回だけ version 3 に書き換える: backend は Incus（URL、指紋、証明書、project はそのまま）、origin は custom（プラグインはその VM ホストを構築していないので修復できない）。秘密鍵は credential store のまま。
- 損失の無い書き換えなので、移行のモジュール（`placement-migration.ts`）の中だけで version 2 を読む。元のファイルは `endpoint.v2.json` に残す。
- install.sh の形 2 で作った VM ホストを managed にしたければ、「別のマシンに構築」を選び直す（ジョブは冪等なので既存の Incus と project を使い、新しい証明書でペアリングし直す）。

### 8.3 version 1

今と同じく読めない（「選び直す」の問題）。

### 8.4 設定（dsh-bot-vm の Config）

- `incusSocket` を消す。
- `incusProject` は「このマシンに構築」「別のマシンに構築」の project の既定値として残す。
- 足すもの: `setupHttpsPort`（既定 8443、構築の詳細の欄の既定値）。

### 8.5 既定の場所を無くすこと

今は何も選ばなければこのマシンのソケットを使う。これを無くすのは、managed の構築と custom の接続がどちらも利用者の操作（sudo か token）を要り、黙ってつなげる既定が無くなるため。ensure の失敗と画面の「VM ホストを選ぶ」で知らせる。

## 9. install.sh の廃止と文書への影響

### 9.1 決めたこと

- install.sh を消す。VM ホストの準備は managed のジョブ（§3）だけ。
- host-setup.sh は残す（§5.5）。人や作者が checkout から直接使える: `sudo infra/vm/host-setup.sh all https token`。
- `infra/incus/create-project.sh` は残す。入口は §9.2。
- 作者用のスクリプト（`build-base-image.sh`、`check-vm.sh`、`export-image.sh`）は、project の宣言（`user.dsh-bots.pool` / `network`）がある VM ホストを前提にするのは変わらない。その VM ホストは作者の DSH の「このマシンに構築」か、`sudo infra/vm/host-setup.sh all` で用意する。`incus` のクライアントを root か `incus-admin` で使えること（`sudo -E infra/vm/build-base-image.sh` か、作者が自分でグループに入る）を infra/RELEASING.md に書く。プラグインはもう `incus-admin` を足さない。確認済み（コードを読んだ、段階 6）: `build-base-image.sh` と `check-vm.sh` は `HOME` も gh も使わず、checkout に何も書かない（一時ファイルは `mktemp`）ので `sudo -E` で走る。`export-image.sh` は incus を使いつつ checkout の `dist/` と `release.env`・`release-env.ts` を書き（root で走らせると持ち主が root になる）、`publish-image.sh` は作者の gh の資格を使うので、作者は `incus-admin` に入ってこの 2 つを自分で走らせる（infra/RELEASING.md に書いた）。未検証: 実際に sudo で build-base-image.sh を通すこと。

### 9.2 create-project.sh の入口

- リリースのタグのソースを codeload から取り、`infra/` だけを展開して実行する（§4.1 のコマンド）。今の install.sh がパイプ実行で取っていたものと同じ源（installer.md §7）で、別の配布物を作らない。
- 版はプラグインの版に合わせる。画面はプラグインの `DSH_BOTS_VERSION`（`release.env`）でコマンドを作る。README には `<版>` を README の版に置いた同じコマンドを書き、`packages/dsh-bot-core/test/create-project-command.test.ts` が一致を確かめる（判断: 画面と同じ関数 `createProjectCommand`（bot-core の `client/vm-host/setup-model.ts`）で README の文字列を作って比べ、画面と README の食い違いも見つける。ルートの test からは design rule 15 でパッケージの src を読めないので bot-core の test に置いた）。確認済み（2026-11-27、段階 6）: v0.4.2 のタグでこのコマンドが `infra/` だけを展開し、`create-project.sh --help` が実行ビット付きのまま動くこと。
- 推測: タグは作り直せるので、sha256 での固定は無い。必要になったら Release に `infra/` の tarball と sha256 を添える（§12）。

### 9.3 影響の一覧（実装の段階 6 で直す）

| もの                                             | 直すこと                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `install.sh`                                     | 消す                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `infra/vm/host-setup.sh`                         | `--events`、`preflight`、`https` / `token` への分割、`local` の削除、`fail` の code、root の検査をフェーズごとに（段階 3）。メッセージの「use install.sh」を消す                                                                                                                                                                                                                                                                                                   |
| `infra/vm/lib.sh`                                | `fail` / `on_error` / `note` のイベント版、JSON の文字列の関数。`ONLY_DSH_HOST` の文を「別のマシンに構築」に                                                                                                                                                                                                                                                                                                                                                       |
| `infra/incus/create-project.sh`                  | 完了の文の「Another machine」を「Use an existing server → Incus」に                                                                                                                                                                                                                                                                                                                                                                                                |
| `infra/vm/build-base-image.sh`、`check-vm.sh`    | 「Prepare this host with install.sh」を「the dsh-bots settings (Build on this machine) or sudo host-setup.sh all」に                                                                                                                                                                                                                                                                                                                                               |
| `infra/vm/publish-image.sh`                      | リリースの notes の「install.sh downloads it」を「the plugin imports it」に                                                                                                                                                                                                                                                                                                                                                                                        |
| `infra/release.env`                              | 頭のコメント（「What install.sh installs」）                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `infra/vm/README.md`                             | 入口、「Incus access」（このマシンも HTTPS と制限付き証明書、incus-admin を消す）、Usage（install.sh の行を消す）、Tear down（`<stateDir>/setup` と SSH 鍵の行）                                                                                                                                                                                                                                                                                                   |
| `infra/RELEASING.md`                             | 作者の VM ホストの用意（§9.1）、リリースの確認（install.sh で clean な VM ホスト → 確認用 DSH の「別のマシンに構築」）、`DSH_BOTS_SOURCE=$PWD bash install.sh` の節                                                                                                                                                                                                                                                                                                |
| `README.md`                                      | Install の 2〜3 を「DSH の dsh-bots の設定 → VM host で場所を選ぶ」1 つに。既存の Incus の管理者向けのコマンドを §9.2 に                                                                                                                                                                                                                                                                                                                                           |
| `CONTRIBUTING.md`                                | 「prepare one with install.sh」を設定画面に                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `docs/agent-setup.md`                            | 書き直す: DSH ホストにプラグインを入れる、画面で場所を選ぶ（エージェントは sudo のパスワードを扱わないので、そこは利用者の操作）、失敗したら「セッションで調べる」の案内、既存の Incus の管理者向けは §9.2                                                                                                                                                                                                                                                         |
| `docs/specs/installer.md`                        | 状態を「廃止」にし、host-setup.sh の中身の記録として残す節と、改めた節を分ける（この段階で頭に注記を入れた）                                                                                                                                                                                                                                                                                                                                                       |
| `docs/specs/incus-endpoint.md`                   | 改めた箇所に注記（この段階で入れた）                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `packages/dsh-bot-vm/README.md`                  | 「The VM host」（保存形式 v3、managed / custom、ジョブ）、設定の表（`incusSocket` を消す、`setupHttpsPort`）、install.sh の記述                                                                                                                                                                                                                                                                                                                                    |
| `packages/dsh-bot-vm/src/host/endpoint-check.ts` | 直し方の文（install.sh、incus-admin）を `ProblemFix`（§5.2）に（段階 2）                                                                                                                                                                                                                                                                                                                                                                                           |
| `test/installer.test.ts`                         | `install.sh` を `bash -n` の一覧から外す。README の版の検査は残し、§9.2 のコマンドの版の一致を足す。束の写し（§5.5）の検査を足す（段階 6: install.sh が無くなったので `test/release-env.test.ts`（release.env と package.json・README の版）、`test/shell-syntax.test.ts`（`bash -n`）、`packages/dsh-bot-core/test/create-project-command.test.ts`（§9.2 のコマンド）に分けた。束の検査は段階 3b の `packages/dsh-bot-vm/test/host-setup-bundle.test.ts` にある） |

## 10. Proxmox（custom のみ）

- custom だけ。managed は Incus だけ（Proxmox のノードを構築する手順は持たない）。
- API だけで動くのが望ましい。無理なら、ノードへの SSH（プラグインの鍵、ホスト鍵の固定は §6.2、§6.3 と同じ作り）も許す。
- `dev/proxmox-spike/` の結果で次を決めた（段階 7）。API だけで動き、ノードへの SSH は使わない。

| 決めたこと               | 決定                                                                                                                                                                                | 節         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| ゲストへの経路           | VM の IP（guest agent の `network-get-interfaces`）へ DSH ホストから直接 TCP 22。sshd は Proxmox の VM でだけ cloud-init で listen させる。シリアルは遅すぎて使わない（spike §3.1） | 10.1、10.6 |
| 権限の閉じ込め           | privsep の API token と、プールに付けたロール `DshBots`、ブリッジの `PVESDNUser`。token は自分の VM のファイアウォールを変えられる（外側での遮断は管理者の判断）                    | 10.7、10.9 |
| イメージ                 | 統合 tarball から `rootfs.img`（qcow2）だけを `import` に上げ、`import-from` でテンプレートにし、linked clone で作る                                                                | 10.4       |
| 初期設定                 | NoCloud の ISO を DSH ホストで作って `iso` に上げ `ide3` に付ける（snippets は上げられない）。初回の起動の後に秘密の無い ISO で上書きして外す                                       | 10.4       |
| ワークスペースのディスク | 起動しない保管用の VM が持ち主の volume を `virtio1` に付ける（`/dev/disk/by-id/virtio-dsh-workspace`）                                                                             | 10.5       |
| ファイアウォール         | VM ごとの options・rules・ipset（Incus の ACL と同じ範囲を拒否、in は DSH ホストの 22 だけ）。データセンターの有効は読めないので egress の実測で確かめる                            | 10.6       |
| 容量                     | プールの comment の管理者の申告と、ストレージの空き                                                                                                                                 | 10.8       |

### 10.1 ベースイメージ（Incus と Proxmox で共通）

ゲストへの経路は VM の IP へ直接 SSH（決定、`dev/proxmox-spike/README.md` §3.2）。VM の IP は qemu-guest-agent の `agent/network-get-interfaces` で読む。イメージは 1 つで、Incus と Proxmox で違うのは cloud-init と VM の設定だけ（`infra/vm/provision-base.sh`、image-20261127 から）。

| もの                                                   | イメージの中                                                                                                                                                                                          | Incus の VM                                                                                                                     | Proxmox の VM                                                                                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `qemu-guest-agent`                                     | 入っている。Debian の unit は static（`systemctl enable` は効かない）で、udev が virtio-serial の port `org.qemu.guest_agent.0` を見つけたときだけ起動する（`60-qemu-guest-agent.rules`、`BindsTo=`） | Incus はその port を作らないので起動しない（inactive、failed にならない。`check-vm.sh` が failed の unit が無いことを確かめる） | VM の設定に `agent: enabled=1`（PVE が port を作る）                                                                           |
| `ssh.service` / `ssh.socket`（Debian の sshd、TCP 22） | どちらも mask                                                                                                                                                                                         | mask のまま。TCP で listen しない（`check-vm.sh` が 22 の listen が無いことを確かめる）                                         | cloud-init の `runcmd` で `ssh.service` だけ unmask して有効にする（下）。`ssh.socket` は mask のまま（22 の取り合いを避ける） |
| `sshd-vsock.socket`（`vsock::22`、enabled）            | 今のまま                                                                                                                                                                                              | 使わない（exec の `sshd -i`、incus-endpoint.md §5.2）                                                                           | 使わない。vsock の device が無い VM での状態は未検証                                                                           |

Proxmox の backend が `cloud-init.ts` の user-data に足すもの（`runcmd` の先頭。ワークスペースの mount が失敗しても SSH で調べられるように）:

```yaml
runcmd:
  - [systemctl, unmask, ssh.service]
  - [systemctl, enable, --now, ssh.service]
  - [sh, -c, "<MOUNT_SCRIPT>", sh, <workspace>, <user>]
  - [sync]
```

- `ssh.service` は Debian の `sshd -D`（`ExecStartPre=sshd -t`）。`sshd_config.d/10-dsh-bot.conf`（鍵だけ、`AllowUsers bot`、`AllowStreamLocalForwarding yes`）がそのまま効く。`enable` は次の起動からも効く。
- イメージに TCP 用の unit を別に足さない（判断: Debian の unit で足り、Incus の VM との違いを cloud-init の 2 行に閉じられる）。`write_files` の印と unit の `Condition…` で切り替える形もとらない（初回の起動では印が `ssh.service` の起動に間に合う保証が無い）。
- `ssh.service` はホスト鍵を作らない。ホスト鍵は cloud-init の `ssh_keys`（init の段）が `runcmd`（final の段）より前に書くので、sshd は初めから固定したホスト鍵で答える。
- 準備の完了は今と同じく SSH で `/var/lib/cloud/instance/boot-finished` を見る（`BOOT_FINISHED`）。
- 確認済み（2026-11-27、Incus の Debian 13 の VM で同じ mask から）: ed25519 のホスト鍵 1 つで `sshd -t` が通り、`0.0.0.0:22` と `[::]:22` で listen し、`bot` の鍵で入れ、`root` は拒否された。確認済み（2026-11-27、入れ子の PVE 9.3.1、image-20261127、段階 7）: `agent: enabled=1` で guest agent が起動し `network-get-interfaces` が `net0` の MAC と IPv4 を返した。`runcmd` の 2 行で `0.0.0.0:22` / `[::]:22` に listen し、作り直した VM でも同じ。`sshd-vsock.socket` は vsock の device が無い PVE の VM でも active で、failed にならなかった。初回の起動だけ `cloud-init-main` / `cloud-init-network` が failed になる（`cc_mounts` の `mount -a` が、まだ `x-systemd.makefs` で ext4 が作られていないワークスペースで失敗する。2 回目の起動からは無い。Incus でも同じだった。fstab の行に `noauto` と `x-systemd.required-by=local-fs.target` を足して直した、incus-endpoint.md §5.4。Proxmox での確認は未検証）。

### 10.2 接続と保存

- 画面（「既存のサーバを使う → Proxmox」）: API のアドレスを入れると `previewCustom` がつないで証明書の sha256 と送り元のアドレスを返し、画面が指紋を出す（管理者は `pvenode cert info` と比べる）。続けて token の id と secret、node、pool、storage、bridge、「このインストールのアドレス」（既定は送り元のアドレス）、DNS サーバ（既定 `1.1.1.1 9.9.9.9`、3 つまで）を受ける。`connectCustom` は `GET /version` で token が通ることを確かめてから placement を書き（失敗なら何も書かない）、検査（§10.7）に進む。
- TLS はノードの証明書の sha256 だけで検証する（CA・ホスト名を見ない。Incus と同じ）。`Authorization: PVEAPIToken=<tokenId>=<secret>`。
- 保存: `StoredProxmox`（§5.1）。secret は credential store の `<scope>/proxmox-token`（payload `{ version: 1, tokenSecret }`。Incus の `<scope>/incus-client` は `{ version: 1, clientKey }` のまま）。backend を替えると前の backend の秘密を消す。
- 「この VM ホストの利用をやめる」は手元の placement と secret を消すだけ（token を消すのは管理者、infra/proxmox/README.md）。
- 実装: `backend/proxmox/endpoint.ts`（入力の形）、`client.ts`（型付きの API と task の UPID 待ち。`exitstatus` が `OK` か `WARNINGS` で成功、それ以外は task の log の末尾を添えて失敗）、`node/proxmox-transport.ts`（HTTPS、証明書の固定、JSON、multipart のアップロード、`probeProxmox`）。設定の `incusTimeoutMs` / `operationTimeoutMs` / `imageUploadTimeoutMs` を API の要求 / task / アップロードの期限に使う。

### 10.3 プールの中のもの

PVE の VM と volume は利用者向けの札を持たないので、VM の説明（`description`）の最後の `dsh-bots-meta: {json}` の行に札を書く（`meta.ts`、`v: 1`）。

| VM                                                          | 札                                                                           | 中身                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------- |
| ボットの VM（`<instancePrefix><bot id>`）                   | `{ kind: "bot", owner, botId, orphanedSince? }`                              | テンプレートの linked clone（`clone full=0`） |
| テンプレート（`dsh-bots-image-<fingerprint 12 桁>`）        | `{ kind: "image", owner, fingerprint, aliases }`                             | 別名（`dsh-bot-base`）は `aliases` で持つ     |
| 保管用の VM（`dsh-bots-volumes-<owner 12 桁>`、起動しない） | `{ kind: "volumes", owner, volumes: { <name>: { botId, orphanedSince? } } }` | ワークスペースの持ち主（§10.5）               |

- 一覧は `GET /pools/<pool>` の VM と、それぞれの `GET …/config`。名前・テンプレートかどうかは config から読む（判断: プールの一覧の `name` / `template` / `status` は pvestatd の集計で、作った直後やテンプレート化の直後に数秒〜十数秒古い。確認済み、入れ子の PVE で `template` が 0 のまま返り別名を付けられなかった）。状態は `status/current`（`qmpstatus` の `paused` は frozen）。
- 他の owner の札の VM には触れない（Incus の `user.dsh-bot.owner` と同じ）。保管用 VM への書き込み（札の変更、空きの virtio への付け外し）はプロセスの中で 1 つずつにする。
- VM id は `GET /cluster/nextid` で取り、作成が「already exists」で失敗したら取り直す（5 回まで。他の作成と競ったとき）。

### 10.4 イメージと cloud-init

- 取り込みの段（`image/importer.ts`）は Incus と同じ。`ImageBackend.upload` は統合 tarball（zstd）を流しながら sha256 を取り、tar の `rootfs.img`（qcow2）だけを `POST …/storage/<s>/upload`（`content=import`、ファイル名 `dsh-bots-<manifest の fingerprint>.qcow2`、Content-Length は tar の見出しの大きさ）に流す（`node/image-unpack.ts`。DSH ホストに qcow2 を書かない）。流し終えた tarball の sha256 が manifest と同じときだけテンプレートを作る: `POST /nodes/<n>/qemu`（`scsi0: <s>:0,import-from=<s>:import/<file>`、`bios: ovmf`、`efidisk0 … pre-enrolled-keys=0`、`machine: q35`、`scsihw: virtio-scsi-single`、`serial0: socket`、`agent: enabled=1`、`net0` の bridge）→ `POST …/template`。
- `point` は札の `aliases` を付け替える。古いテンプレートは別名が無く linked clone も無いときに消す（`discard`、またはボットの VM を消したときにその元のテンプレートについて調べる）。linked clone があるうちは消さない（PVE が base を消させない）。
- 消せないもの: import のファイルと ISO は token では消せない（`Datastore.Allocate` が無い、spike §2）。同じ名前の上書きはできるので、ISO はボットごと、import はイメージの版ごとに 1 つ。片付けは管理者（infra/proxmox/README.md）。
- cloud-init: NoCloud の ISO（`seed.ts` の最小の ISO 9660、ボリューム名 `cidata`）を `content=iso` で `dsh-bots-seed-<VM 名>.iso` に上げ、`ide3`（cdrom）に付ける。user-data は `cloud-init.ts` のまま（`sshd: listening` で §10.1 の 2 行が付く）。network-config は clone の後に読んだ `net0` の MAC で NIC を選び（名前の glob は使わない、spike §5）、placement の DNS サーバを足す。DHCP の DNS も残る（確認済み: Debian 13 の cloud-init 25.1.4 は networkd の設定を書き、v2 の `dhcp4-overrides.use-dns: false` を写さなかった）。私設の DHCP の DNS は egress の REJECT ですぐ失敗し、resolved が次のサーバに移る（確認済み、名前の解決 32 ms）。placement に私設の DNS を書いたときだけ 53 番を通す。
- 初回の起動の後（`settle`）に、同じ名前の ISO を秘密の無いもの（user-data `{}`）で上書きしてから `delete: ide3`（動いている VM では次の起動で効く）。VM を消すときも、まだ付いていれば上書きしてから消す。

### 10.5 ワークスペース

- 持ち主は保管用の VM（§10.3）。`POST …/storage/<s>/content { vmid: <保管用>, filename: vm-<保管用>-<名前>.raw, size, format: raw }` で作り、ボットの VM の `virtio1: <volid>,serial=dsh-workspace,discard=on,iothread=1` に付ける。ゲストでは `/dev/disk/by-id/virtio-dsh-workspace`（`workspaceDevice`）。札は保管用 VM の説明に書く（作る前に書く。札だけ残っても一覧は volume から作るので害が無い）。
- VM を消すときは先に `delete: virtio1` で参照を外してから `DELETE …?purge=1&destroy-unreferenced-disks=0`。
- 拡張: 付いている VM の `PUT …/resize`（動いたままでも通る、spike §6）。どの VM にも付いていないとき（VM を消した後に大きくして作り直す）は、保管用 VM の空いた `virtioN` に付けて広げ、外す（持ち主から外すと `unusedN` になって残る）。
- 削除: 保管用 VM の `virtioN` か `unusedN` に置き、`unusedN` を `delete` すると消える。ほかの VM が参照していれば消さずに失敗する。
- `attached` は保管用以外の VM の disk の設定に volid があるか。

### 10.6 ネットワークとゲストへの経路

- 経路は VM の IP へ DSH ホストから直接 TCP 22（`GuestRoute.open`）。IP は `GET …/agent/network-get-interfaces` の、`net0` の MAC の IPv4（169.254 を除く）。guest agent が答えないうち（起動の途中）は open が失敗し、環境の `waitForSsh` が待ち直す。DSH の中の中継と ProxyCommand、ホスト鍵の固定は Incus と同じ。
- ファイアウォール（VM を作るたびに書き直す、`firewall.ts` / `network.ts`）: options `enable=1 policy_in=DROP policy_out=ACCEPT dhcp=1 macfilter=1 ipfilter=1 ndp=0 radv=0`、`net0` に `firewall=1`。規則は上から、in ACCEPT tcp 22 source <sshSource>、私設の DNS サーバがあれば out ACCEPT udp/tcp 53、out REJECT `0.0.0.0/8,10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.0.0.0/24,192.168.0.0/16,198.18.0.0/15,224.0.0.0/3`（`infra/incus/objects.sh` の ACL と同じ範囲）、out REJECT `::/0`。
- `ipfilter` の ipset `ipfilter-net0` は空で作り、`open` のたびに guest agent が答えた IP だけにする（判断: IP は DHCP で決まるので作るときには書けない。spike §7 で空の ipset は送信がすべて落ちた。DHCP は `dhcp=1` で通る）。
- `sshSource` は VM から見た DSH ホストのアドレス。既定は API への接続の送り元で、VM のネットワークとの間に NAT があるときは利用者が直す。
- データセンターのファイアウォールが無効だと VM の規則は効かず、token からはそれを読めない（`Sys.Audit`）。Incus と同じく、ensure の最後の egress の実測（`egress-probe.ts`、ゲストの SSH の上）で確かめ、「ネットワークの隔離」に出す。

### 10.7 検査と問題

`check` は次を順に見て、問題（scope `proxmox`）を返す。直し方は管理者向けのコマンドか文（custom なので `repair` は出さない）。

| code                                           | 見るもの                                                                                                                                                                                                 | 直し方                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `unreachable` / `untrusted` / `token-rejected` | `GET /version` が答える / 証明書が固定のもの / 401 でない                                                                                                                                                | ノードと 8006 / `pvenode cert info` と比べてつなぎ直す / 新しい token |
| `version-too-old`                              | 9.0 以上（判断: 確かめたのは 9.3 だけ）                                                                                                                                                                  | 上げる                                                                |
| `node-missing`                                 | `GET /nodes` に online である                                                                                                                                                                            | ノード名を直してつなぎ直す                                            |
| `privilege-missing`                            | `GET /access/permissions?path=/pool/<pool>` に VM 系と `Pool.Audit`、`path=/storage/<s>` に `Datastore.Audit / AllocateSpace / AllocateTemplate`（応答の値は伝播の印で、鍵があれば持っている。確認済み） | `create-pool.sh`                                                      |
| `pool-missing` / `pool-limits-undeclared`      | プールがある / comment に `dsh-bots: cpus=<n> memory=<n>GiB`                                                                                                                                             | `create-pool.sh` / `pvesh set /pools/<p> --comment …`                 |
| `storage-missing` / `storage-unusable`         | ノードにある / 有効で、content に `images,import,iso`、プールの member                                                                                                                                   | `pvesm set … --content …` など                                        |
| `bridge-missing` / `bridge-denied`             | `GET /nodes/<n>/network` にある / `/sdn/zones/localnetwork/<bridge>` に `SDN.Use`                                                                                                                        | つなぎ直す / `create-pool.sh`                                         |
| `guest-unreachable`                            | ほかに問題が無いとき、動いているこの owner のボットの VM（3 台まで）の IP の 22 に DSH ホストから届く                                                                                                    | ブリッジのネットワークへの経路、`sshSource`                           |

権限は spike §2 のロールから、使わないもの（`VM.Config.Cloudinit`、`VM.Console`、`SDN.Use` はブリッジの ACL で別に）を外した。

### 10.8 容量

管理者の申告（プールの comment の `cpus` / `memory`）が上限。CPU はその値、メモリは上限からプールの他の VM（テンプレートと保管用を除く、他の owner も含む）の `maxmem` を引いた値、ワークスペースはストレージの `avail` に、ボットの今のワークスペースの大きさ（`avail` にはもう入っていない）を足し、ボットの VM がまだ無ければ `rootDiskGiB` を引いた値。下限は今のワークスペースの大きさ（Incus と同じ、`capacity-steps.ts` の `workspaceRange`。Incus はプールの大きさと project の `limits.disk*` が上限なので今の大きさを足さず、上限が今の大きさを下回らないようにだけする。bot-vm-spec.md §4。thin なストレージでは `avail` が実際に使った分しか引かないので甘めになる、未検証）。刻みは Incus と同じ（`capacity-steps.ts`）。ノードの CPU・メモリは token から読めないので見ない（spike §8）。

### 10.9 管理者の準備

`infra/proxmox/create-pool.sh`（ノードの root、冪等）がストレージ（無ければ dir）、プールと上限の comment、ロール `DshBots`、ユーザと privsep の token、ACL（ユーザと token の両方）を作り、データセンターのファイアウォールを確かめ（`--enable-firewall` で有効にする）、画面に入れる値を出す。画面の「サーバの管理者向け」は Incus と同じ codeload のコマンドで `infra/proxmox/create-pool.sh --help` を出す（README と同じ文字列をテストで保つ）。詳しくは infra/proxmox/README.md。

## 11. 実装の段階（worktree）

| #   | worktree / ブランチ        | 範囲                                                                                                                                                                                                                                                                | 並行                                                                      |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1   | `feat/vm-host-modes-spec`  | この文書と、incus-endpoint.md・installer.md・ui-design.md の注記と書き直し                                                                                                                                                                                          | —                                                                         |
| 2   | `feat/vm-backend-contract` | bot-core の `shared/environment-host.ts`・`contract.ts`（§5.2、`setup` と `custom` は型だけ）、dsh-bot-vm の `VmBackend` と Incus の実装（§5.3）、`PlacementStore` v3 と移行（§8）、Unix ソケットの transport と `incusSocket` の削除、画面は型に合わせる最小の変更 | 3a と並行できる（範囲が重ならない）                                       |
| 3a  | `feat/host-setup-events`   | `infra/vm/host-setup.sh`・`lib.sh`・`infra/incus/objects.sh` の `--events`、フェーズの分割、`fail` の code、シェルのテスト（vitest から bash を実行し、イベントを検査）                                                                                             | 2 と並行                                                                  |
| 3b  | `feat/setup-jobs`          | dsh-bot-vm の HostShell（local / ssh）、SSH の鍵・known_hosts・config、束の build と検査、`reduceSetupJob` と SetupRunner、ジョブの永続化、`VmHostSetup` の Host 側                                                                                                 | 2 と 3a の後                                                              |
| 4   | `feat/vm-host-wizard`      | bot-core のクライアント（VM host の画面、ui-design.md）、Remote の `botEnvironmentHost`、i18n                                                                                                                                                                       | 2 の後。3b と並行できる（Remote の型が 2 で決まっていれば、偽の Host で） |
| 5   | `feat/setup-investigation` | dsh-bot-vm の SetupBrief、bot-core の `investigateSetup`（`index.ts`）、失敗の画面のボタン、design-rules.md の rule 1 の注記、§7.1 の未検証の確認                                                                                                                   | 3b と 4 の後                                                              |
| 6   | `feat/retire-install-sh`   | §9.3 の一覧（install.sh の削除、README、agent-setup.md、RELEASING.md、installer.md、test）                                                                                                                                                                          | 3a の後。4・5 と並行できる（README は 6 だけが触る）                      |
| 7   | `feat/proxmox-backend`     | `VmBackend` の Proxmox の実装、custom の Proxmox の画面                                                                                                                                                                                                             | spike と 2 の後                                                           |

- 段階 6 の実装（2026-11-27）: §9.3 の一覧のうち段階 2〜4 で済んでいなかったもの（install.sh、README、CONTRIBUTING.md、agent-setup.md、RELEASING.md、installer.md、infra/vm/README.md、dsh-bot-vm の README の要件、infra の作者用スクリプトと create-project.sh の文、release.env の注記、test）。install.sh だけが使った host-setup.sh / lib.sh の `DSH_BOTS_REPORT`・`DSH_BOTS_NOTE`・`DSH_BOTS_TOKEN_FILE` も消した（`--events` の無い token は stdout）。CI のワークフローは install.sh を名指ししていなかった（shellcheck は `git ls-files '*.sh'`）。
- Release は 6 まで済んでから作る（2 で Unix ソケットを消すと、version 2 の local の利用者は 4 の移行の画面まで移行できないため）。2〜5 の間の確認は、custom の Incus（`core.https_address=127.0.0.1:8443` の token）で行う。
- 動作確認は確認用の DSH と専用の Incus project（`dsh-bots-test` など）で行う。managed の「別のマシンに構築」は使い捨ての VM（入れ子の KVM、installer.md §10 と同じ）に対して行う。普段の DSH と project `default` / `dsh-bots` / `dsh-mv` には触れない。「このマシンに構築」の通しの確認は、このホストの Incus を変える（`core.https_address`、ブリッジ、ACL）ので、このホストでは行わず使い捨ての VM の中で行う。

## 12. 未決と未検証

- 未検証: sudo `-S` がパスワードを拒んだときの読み直しと、`requiretty` の OS（§5.4）。sudoers に入っていない一般ユーザの判定（`sudo -n true` はどちらも「パスワードが要る」を返す、推測）。
- 未検証: SSH が切れたときに VM ホストの root のプロセスが stdin の EOF を受けて止まること（§5.5）。apt の途中で止めずに済むこと（bash は前景のコマンドが終わってから trap を実行する、推測）。DSH の再起動で中断した apt の後の `dpkg --configure -a` の要否。
- 未検証: Remote の引数（sudo のパスワード）が DSH の gateway のログに残るか（§6.1）。
- 未決: managed の VM ホストをやめるとき（「Stop using this VM host」）に、プラグインが root で自分の証明書を外し、作ったもの（ブリッジ、ACL、project）を片付けるか。この文書では custom と同じく案内だけにする。やめた後の placement は `none`（段階 2 で決めた）。
- 未決: remote の managed で ufw の HTTPS のポートを DSH ホストのアドレス（`$SSH_CLIENT`）だけに開けるか。今は全体に開ける（今の `phase_remote` と同じ）。証明書の認証で守られる。
- 未決: create-project.sh の配布物の sha256 での固定（§9.2）。
- 未決: 1 台の VM ホストだけ。ボットごとに置き場所を選ぶのは今と同じく後回し（placement をボットごとに持てる形にはしていない）。
- Proxmox（§10）の未検証: クラスタ（複数ノード）、dir 以外のストレージ（LVM-thin・ZFS・Ceph。content に import と iso が要るので今はファイルのストレージだけ）、token の期限の切れと作り直し、2 台の VM の間の遮断と IPv6、DHCP の更新で IP が変わったときに `open` の前に通信が止まる間。
