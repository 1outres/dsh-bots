# インストーラ（install.sh）: VM ホストの準備

ボットの VM を動かすマシン（VM ホスト）を、次の 1 行で dsh-bots が使える状態にする。DSH のホストではインストーラを使わない（プラグインを入れて設定画面で VM ホストを選ぶだけ。docs/specs/incus-endpoint.md §2、§3）。

```sh
curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash
```

main の `install.sh` は入口だけで、最新の公開済みリリースのソースを取ってその `install.sh` を実行する（§7、§10）。

## 1. 対象と前提

- CPU: x86_64 のみ。KVM が使えること（`/dev/kvm`）。init は systemd。
- OS（VM ホスト）: Debian 13 / 12、Ubuntu 24.04、Fedora 42 以上。ほかは理由を示してステップ 1 で止まる（§3）。
- 形（docs/specs/incus-endpoint.md §2）をステップ 2 で選ぶ:
  - `local`（形 1）: DSH が同じマシンで動く。DSH を動かすユーザで実行し（root では止まる）、そのユーザを `incus-admin` に入れる（Unix ソケット）。
  - `remote`（形 2）: DSH は別のマシン。`core.https_address` を開け、project に限った trust token を最後に表示する。root で実行してもよい。
- root 権限は sudo で 1 回だけ求める（root で実行したときは求めない）。
- DSH・Node・pnpm は確かめない（VM ホストには要らない）。
- 形 3（他の用途の Incus サーバ）は `install.sh` を使わず、管理者が `infra/incus/create-project.sh`（§6）。

## 2. ステップ

| #   | 表示                            | 内容                                                                                                     | root |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Checking system                 | アーキテクチャ、VM ホストになれる OS か（§3）、systemd が PID 1、`/dev/kvm`、空き容量                    | –    |
| 2   | Choosing where DSH runs         | `DSH_BOTS_ACCESS`（`local` / `remote`）、無ければ前回の選択、無ければ尋ねる（端末が無ければ止まる）      | –    |
| 3   | Installing packages             | OS ごとのパッケージ（§3）、`vhost_vsock`（exec が incus-agent に vsock で届く）、Incus 6.0.4 以上と qemu | ✓    |
| 4   | Configuring Incus               | ストレージプール、ブリッジ、ACL、project（docs/specs/incus-endpoint.md §3.4、プロファイルは作らない）    | ✓    |
| 5   | Checking the firewall           | FORWARD を落とす他のファイアウォール（§4）                                                               | ✓    |
| 6   | Letting DSH use Incus（local）  | DSH のユーザを `incus-admin` に入れる                                                                    | ✓    |
| 6   | Issuing a trust token（remote） | `core.https_address`（未設定なら `:8443`）、ufw / firewalld でそのポート、制限付き token の発行          | ✓    |

中身は `infra/vm/host-setup.sh <phase>`（`packages` / `incus` / `firewall` / `all` / `local` / `remote`）。host-setup.sh は root で非対話・冪等に動く単体のスクリプトで、直接使ってもよい。Incus の資源（ACL、ブリッジ、project、token）の作り方は `infra/incus/objects.sh` にあり、形 3 のスクリプトと共有する。

完了時:

- local: DSH の画面で「dsh-bots の設定 → VM ホスト → このマシン」を選ぶよう示す。グループに加えたときは DSH の再起動（シェルから起動するならログインし直し）を、プラグインの入れ方（`dsh plugin --profile <p> add @1outres/dsh-bots@<版>` か Plugins 画面）と合わせて示す。
- remote: token を表示し、「dsh-bots の設定 → VM ホスト → 別のマシン」に貼るよう示す。token はログに書かない（root が書く一時ファイル `~/.local/state/dsh-bots/.token.*` を経て表示し、終了時に消す）。再実行すると同じ名前の未使用の token を取り消して新しく出す。
- イメージの取り込み、VM の起動の確認は無い。プラグインが画面で行う（docs/specs/incus-endpoint.md §5.5、§5.1 の `check`、§6.4 の実測）。手で確かめたいときは `infra/vm/check-vm.sh`（イメージを取り込んだ後、VM ホストで一時 VM を project に作り、exec・インターネット・ゲートウェイへの拒否を見て消す）。

project の中身: `features.images/profiles/storage.volumes=true`、`features.networks=false`、`restricted=true`、`restricted.networks.access=<ブリッジ>`、ほかのプールすべてに `limits.disk.pool.<名前>=0`、`user.dsh-bots.pool` / `network` / `egress-acl`。上限（`LIMIT_VMS`、`LIMIT_CPU`、`LIMIT_MEMORY`、`LIMIT_DISK`）は与えたときだけ。既にある project の `features.*` が違えば止まる（中身があると変えられないので、別の名前か削除を示す）。

## 3. OS ごとの差

| OS                    | Incus の入手                                                                               | 備考                                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Debian 13             | main（6.0.4）                                                                              |                                                                                                                                                                                                                                                                              |
| Debian 12             | Zabbly `lts-6.0`（QEMU 同梱）。第三者リポジトリなので先に 1 行で尋ねる（非対話なら止まる） | main に Incus が無い                                                                                                                                                                                                                                                         |
| Ubuntu 24.04          | Zabbly `lts-6.0`（同上）                                                                   | universe の 6.0.0 は 6.0.4 より古い                                                                                                                                                                                                                                          |
| Fedora 42+            | 公式                                                                                       |                                                                                                                                                                                                                                                                              |
| Arch、NixOS、WSL2     | —                                                                                          | **VM ホストとしては対象外**（動作を確かめていない。WSL は無操作で止まる）。DSH のホストにはなれる（プラグインだけで動く）ので、その旨と、VM ホストを別に用意してペアリングすることを示して止まる                                                                             |
| RHEL/Rocky/Alma 9・10 | —                                                                                          | **対象外**。EPEL 9・10 に incus が無い。COPR `neelc/incus`（7.0.0）も `neil/incus`（6.8）も「QEMU command not available: qemu-system-x86_64」で VM ドライバが動かない（確認済み）。EL の QEMU には Incus の VM が使う SPICE も無い（lxc/incus#1301）。DSH のホストにはなれる |

どの OS でも `btrfs-progs`、`e2fsprogs`、`nftables`、`zstd`（Incus がイメージの取り込みで使う）を入れる。socat・virtiofsd は要らない（exec 越しの SSH と block のボリューム、docs/specs/incus-endpoint.md §5.2、§5.4）。パッケージ名は `infra/vm/host-setup.sh` の `phase_packages` にだけ書く。

## 4. ファイアウォール

VM の通信は Incus の `inet incus` テーブルで許可されても、別のテーブルの forward フックが落とせば止まる。ステップ 5 は次を調べる:

| 検出                                                                                             | 対処（自動）                                                                                                           |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| ufw が active                                                                                    | `ufw allow in on dshbr0`、`ufw route allow in on dshbr0`、`ufw route allow out on dshbr0`                              |
| firewalld が running                                                                             | `--permanent --zone=trusted --add-interface=dshbr0`、reload                                                            |
| Docker（`DOCKER-USER` チェーンがある）                                                           | `dsh-bots-docker-forward.service`（docker.service の後に `DOCKER-USER` へ dshbr0 の 2 規則を入れる）を入れて有効にする |
| それ以外で forward フックの policy が drop の base chain（`nft list chains`、`inet incus` 以外） | 何が見つかったかを示して止まる                                                                                         |

いずれも VM→Host の拒否（Incus の ACL）は変えない。iptables-legacy の規則は nft から見えないので、`check-vm.sh` の HTTPS の確認で見つける。remote のステップ 6 は ufw / firewalld に HTTPS のポートを開ける（ほかの場所、クラウドのセキュリティグループなどは利用者が開ける）。

## 5. sudo と出力

- sudo は、ステップ 2 の後に一度だけ理由を 1 行示して `sudo -v`。実行中は更新する。host-setup.sh は自分で sudo しない（root でなければ止まる）。
- 端末（stdout が tty）のときだけ色。各ステップ 1 行。進行中は `…`、終わったら同じ行を `✓`/`✗` で書き換える。詳細はすべてログへ。
- 失敗時だけ、何が・どう直す・ログの場所。
- 入力は /dev/tty から。`DSH_BOTS_NONINTERACTIVE=1`（エージェント向け、[agent-setup.md](../agent-setup.md)）なら端末を読まない。端末が無いとき、形の選択は止まり（`DSH_BOTS_ACCESS`）、第三者リポジトリの確認は「いいえ」なので止まり（`DSH_BOTS_YES=1` で通す）、sudo にパスワードが要れば止まる。
- ステップの関数は errexit のサブシェルで動き、失敗したコマンドで止まる。root のスクリプトは `fail`（何が・どう直す）を `DSH_BOTS_REPORT` に書き、それ以外の失敗は ERR trap が「どのコマンドが何行目で」を書く。

成功時（remote）:

```
dsh-bots VM host installer 0.4.0
[1/6] Checking system ............... ✓ Debian GNU/Linux 13 (trixie), KVM
[2/6] Choosing where DSH runs ....... ✓ DSH on another machine, over HTTPS
  Root access is needed to install packages and set up Incus and the firewall (sudo).
[3/6] Installing packages ........... ✓ Incus 6.0.4
[4/6] Configuring Incus ............. ✓ project dsh-bots (pool dsh, network dshbr0)
[5/6] Checking the firewall ......... ✓
[6/6] Issuing a trust token ......... ✓ listening on :8443, token for dsh-bots

Done. Paste this trust token in DSH: dsh-bots settings → VM host → Another machine.

eyJjbGllbnRfbmFtZSI6…

It pairs one DSH, once. Run this again for a new token (it replaces an unused one).
```

## 6. 既存の Incus サーバ（形 3）: infra/incus/create-project.sh

管理者が自分の Incus に対して実行する（root 不要、`incus` のクライアントだけ。`--remote <名前>` で incus の remote に対して）。入口は `install.sh incus-project <オプション>` でもよい（リリースのソースを取って実行する）。

- 引数: `--pool`（必須）、`--network <既存>` か `--bridge <名前> --cidr <ゲートウェイ/長さ>`、`--acl <既存>` か `--create-acl <名前>`（勧める ACL。新しいブリッジには付け、既存のネットワークには `--attach-acl` のときだけ付ける。そのネットワークの他のインスタンスにも効くため）、`--cpu` / `--memory` / `--disk`（必須。共有のサーバではホストの資源を上限にできない、docs/specs/incus-endpoint.md §5.6）、`--vms`、`--project`（既定 `dsh-bots`）、`--client-name`、`--no-token`。
- サーバの検査: Incus 6.0.4 以上、qemu ドライバ、`core.https_address` が設定済み（無ければ設定の仕方を示して止まる。サーバの設定は変えない）。
- 作るもの: §2 と同じ project（`user.dsh-bots.egress-acl` は ACL を指定したときだけ。無ければ画面が警告する）と、制限付き token。
- 注意として、dsh-bots の SSH が張ってある間は incusd の停止・再起動が `core.shutdown_timeout`（既定 5 分）まで待つこと（docs/specs/incus-endpoint.md §8.2）を表示する。

## 7. 状態

- 正は実機の状態（パッケージ、Incus の資源）。各ステップはまず調べ、済みなら飛ばす。だから途中で止まっても再実行で続きから進む。
- `~/.local/state/dsh-bots/`（`XDG_STATE_HOME`）: `install.env`（選んだ形 `access`）、`logs/install-<時刻>.log`、`source/<ref>/`（パイプ実行で取ったソース）。
- `infra/release.env`（`DSH_BOTS_VERSION`、`DSH_VERSION`、`IMAGE_TAG`、`IMAGE_MANIFEST_SHA256`）: インストーラは版の表示と完了時のプラグインの指定にだけ使う。`DSH_BOTS_VERSION` と `DSH_VERSION` は `packages/dsh-bots/package.json` の `version` と `engines.dsh`、README の指定に一致させ、`test/installer.test.ts` が確かめる。`IMAGE_*` は `export-image.sh` が書き、プラグインの `src/host/image/release-env.ts` と一致する。
- 取るソース: 既定は最新の公開済みリリース（GitHub API `repos/1outres/dsh-bots/releases/latest` の `tag_name`、`v<版>`）。Release ワークフローが npm への公開とイメージの確認を済ませてから作るので、main が先に進んでも影響しない。latest が `v<版>` でなければ、何が起きたかと `DSH_BOTS_REF=<タグ>` を示して止まる。`DSH_BOTS_SOURCE=<dir>` ならその checkout。

## 8. イメージの配布

- 作者: VM ホストとして準備したマシン（形 1）で `infra/vm/build-base-image.sh`（project `dsh-bots` の中で、宣言されたプールとネットワークでビルダーを動かし、別名 `dsh-bot-base` に公開）→ `infra/vm/export-image.sh <tag>`（1900 MiB ごとに分け、`manifest.txt` を作り、`release.env` とプラグインの `release-env.ts` を書く）→ `infra/vm/publish-image.sh`（`infra/RELEASING.md`）。
- Release ワークフローは公開の前に `infra/vm/check-image-release.sh` で、`IMAGE_TAG` のリリースと `manifest.txt` の sha256 を確かめる。
- 取り込みはプラグインが行う（docs/specs/incus-endpoint.md §5.5）。

## 9. 構成

- `install.sh`（ルート）: 1 ファイル。パイプで実行されたときは `DSH_BOTS_REF` のソースの tarball を取り、展開した `install.sh` を `DSH_BOTS_SOURCE=<展開先>` で実行し直す。`incus-project` は `infra/incus/create-project.sh` に渡す。
- `infra/vm/host-setup.sh`: root の設定（§2）。`infra/vm/lib.sh`: OS の判別と失敗の報告。`infra/incus/objects.sh`: ACL・ブリッジ・project・token（host-setup.sh と create-project.sh が共有）。
- `infra/vm/check-vm.sh`: VM ホストの手での検査。
- `infra/vm/build-base-image.sh` / `provision-base.sh` / `export-image.sh` / `publish-image.sh`: 作者用。`check-image-release.sh`: 作者と Release ワークフロー。

## 10. 試験

- 静的: `bash -n`、shellcheck（CI が公式のバイナリで実行）、`pnpm test` に `release.env` とパッケージ・README の一致。
- 動作: Incus の専用 project に Debian 13 / 12、Ubuntu 24.04、Fedora の使い捨ての VM（入れ子の KVM）を作り、それぞれで形 2 を最後まで（token の発行まで）通す。少なくとも 1 つで、確認用 DSH から token でペアリングし、イメージを取り込み、ボットを作って会話するところまで。形 3 のスクリプトは別の VM の Incus に対して remote で通す。
