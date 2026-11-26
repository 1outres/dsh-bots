# VM ホストの形（managed / custom、場所、backend）

状態: 仕様（段階 2 まで実装）。docs/specs/incus-endpoint.md の形 1〜3 と docs/specs/installer.md の install.sh を、この文書で改める（§11 の段階で実装する）。

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
- ペアリングの後の placement の書き込みは 1 回（§5.1）。ジョブが失敗している間は今の placement を変えない。イメージのステップの失敗では placement は書いた後なので、ボットは使えるがイメージが無い状態になり、「Base image」が今と同じに直し方を出す。

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

- `StoredProxmox` のフィールドは spike で増減する（§10）。
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
      readonly hostKeyFingerprint: string
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
      readonly tokenId: string
      readonly serverFingerprint: string
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

const PROXMOX_PROBLEM_CODES = ["unreachable", "untrusted", "token-rejected"] as const

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
  inspect(site: SetupSite, signal?: AbortSignal): Promise<SetupInspection>
  start(request: SetupStartRequest): SetupJobView
  cancel(jobId: string): SetupJobView
  dismiss(jobId: string): void
  brief(jobId: string): SetupBrief
}

interface VmHostCustom {
  preview(credential: CustomCredential): CustomPreview
  connect(request: CustomConnectRequest, signal?: AbortSignal): Promise<EnvironmentHostView>
}

type CustomCredential =
  | { readonly backend: "incus"; readonly trustToken: string }
  | {
      readonly backend: "proxmox"
      readonly url: string
      readonly tokenId: string
      readonly serverFingerprint: string
    }

type CustomPreview =
  | ({ readonly backend: "incus" } & TrustTokenPreview)
  | {
      readonly backend: "proxmox"
      readonly url: string
      readonly tokenId: string
      readonly serverFingerprint: string
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
    }
```

- 今の `useLocal` と `setProject` は無くす。このマシンは managed のジョブで、project は構築か接続のときに決める（変えるときは選び直す）。
- `EnvironmentHostCheck` の `declaration` は backend ごとの判別共用体にする（Incus は今の pool / network / egressAcl、Proxmox は spike で決める）。
- `ProblemFix` の `repair` は origin が managed のときだけ使う。managed で `unreachable` などになったら、custom 向けの「管理者に頼む」ではなく修復を出す。
- Remote（`botEnvironmentHost`）は上のメソッドをそのまま並べ、加えて `investigateSetup(jobId): { sessionId }`（§7）を持つ。`BotEnvironmentHostState` は `EnvironmentHostSettingsView` に `setup` が増えるだけ。段階 2 の Remote は `custom` の 2 つを `previewCustom(credential)` と `connectCustom(request)` として並べ、今の `previewToken` / `pair` / `useLocal` / `setProject` を消した。`setup` の Remote は段階 4 で足す。
- 段階 2 では `setup` の Host 側（`VmHostSetup`）は型だけで、どのメソッドも「この版では使えない」で失敗する（段階 3b で実装）。`custom` の proxmox の枝も同じ（段階 7）。setup 系の型は `shared/vm-host-setup.ts` に置いた（§5.6 の型と `SetupBrief`）。
- 段階 2 の `EnvironmentHostDeclaration` の proxmox の枝は仮に `{ kind: "proxmox", node, pool }`。
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

interface GuestRoute {
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
- Incus の実装は `src/host/backend/incus/`（`backend.ts` と、今の `IncusClient`、check、layout、reconfigure、capacity、pairing、trust token）。check はこの宣言（pool / network / egressAcl）を覚え、ボリュームと VM の操作はそれを使う。環境は ensure・remove・capacity・reconcile のたびに `check` を呼び直す。最初の実装は Incus だけ。Proxmox の placement は読めるが、つなぐと「この版では使えない」で失敗する。

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
  readonly exit: Promise<{ readonly code: number | null; readonly signal: string | null }>
}
```

- 実装は 2 つ: `localShell`（`child_process.spawn`、シェルを通さない）と `sshShell`（`ssh -F <stateDir>/setup/ssh/config -T dsh-bots-vm-host -- <argv をシェル用に引用した 1 行>`）。手順（`SetupRunner`）は HostShell しか知らず、local と remote で同じ。
- root: `sudo -S -p '' -- env <env> <argv>`。パスワードがあれば stdin の 1 行目に書く。パスワードが要らなければ `sudo -n`。`already-root` は sudo を通さない。
- stdin はパスワードの後は制御の行だけを運ぶ。`cancel` を書くと host-setup.sh は今のコマンドが終わったところで止まる。stdin の EOF（DSH が止まった、SSH が切れた）も取り消しとして扱う（§5.5）。根拠: 誰も見ていない root の処理を残さないため。
- `hello` イベント（§5.5）を受けるまで stdin にパスワードの他は何も書かない。sudo がパスワードを拒むと stdin からもう一度読もうとする（推測: sudo の `-S` の振る舞い）ので、stderr の `Sorry, try again` か 10 秒以内に hello が無いことで失敗 `sudo-rejected` にしてプロセスを止める。
- `stage`: local はプラグインの `lib/host-setup/`（読み取りだけ）をそのまま使う。ssh は `mktemp -d`（0700）に tar を stdin で送り、`sha256sum` で束を確かめ、ジョブの終わりに消す。

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
- 再実行: 同じ ID のジョブの `attempt` を 1 つ増やし、ステップをすべて pending に戻す。済んだフェーズは `changed: false` で skipped になる。sudo のパスワードは改めて受ける（§6.1）。事前検査は再実行の前にもう一度行い、`inspectionId` は最新のものだけを受け付ける。
- 残すのは最後の 5 つのジョブ。`dismiss` は終わったジョブを画面から外す（ファイルは 5 つの枠で消える）。
- 同時に 1 つ: `start` は走っているジョブがあれば `setup-busy` で拒む。

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
- 未検証: `cwd` だけで作ったセッションが DSH の画面のどこ（どの Workspace）に並ぶか。cwd ごとに Workspace ができる可能性がある（推測）。cwd を `<stateDir>/setup/jobs/<id>/` にすると、ジョブごとに Workspace が増えるかもしれない。段階 5 で確かめ、増えるなら cwd を `<stateDir>/setup/` 1 つにして資料のパスをメッセージで渡す。
- 未検証: bot-core のサイドバーがこのセッションをボットのものと誤らないこと（bot-core はボットのセッションを preset と記録で見分ける。コードは読んでいない）。

### 7.2 初めのメッセージ

英語で書く（モデル向け。DSH の既定の preset が日本語の利用者に日本語で答えるかはモデル次第）。次を順に入れる。

1. 何をしていたか: 「dsh-bots の VM ホストの構築（managed、Incus）が失敗した。原因を調べ、直し方を提案してほしい」。
2. 対象: site（このマシン、または `user@host:port`）、OS（fact `os`）、Incus の版（あれば）、project。
