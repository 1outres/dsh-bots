# インストーラ（install.sh）

作者のホスト以外の Linux x86_64 で、次の 1 行から dsh-bots のプラグインが使える状態まで進める。

```sh
curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash
```

main の `install.sh` は入口だけで、最新の公開済みリリースのソースを取ってその `install.sh` を実行する（§8、§11）。

## 1. 対象と前提

- CPU: x86_64 のみ。KVM が使えること（`/dev/kvm`）。
- OS: Debian 12/13、Ubuntu 24.04、Fedora 42 以上、Arch Linux、NixOS。それぞれ WSL2 上でもよい。init は systemd。RHEL/Rocky/Alma 9・10 は対象外（§3）。
- DSH は入っている前提。`dsh` が PATH に無い、または版が `packages/dsh-bots/package.json` の `engines.dsh`（検証済みの版ちょうど）と違うときは、要る版を示して止まる。
- 一般ユーザで実行する（DSH を動かすユーザ = `DSH_USER`）。root 権限は sudo で 1 回だけ求める。root で直接実行したときは `DSH_USER` の指定が要る。

## 2. ステップ

| #   | 表示                       | 内容                                                                                                                                              | root |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Checking system            | アーキテクチャ、OS の判別、systemd が PID 1、`/dev/kvm`、WSL2 の条件（§4）、空き容量                                                              | –    |
| 2   | Checking DSH               | `dsh --version` が要る版か、`node` と `pnpm`（`dsh plugin` が使う）があるか、どのプロファイルに入れるか（§6）、同じ行を入れる別のバンドルが無いか | –    |
| 3   | Installing packages        | OS ごとのパッケージ（§3）。NixOS はモジュールを書き出して止まる（root 不要）                                                                      | ✓    |
| 4   | Configuring Incus          | サービス、ストレージプール、ブリッジ、ACL、プロファイル、`incus-admin` グループ                                                                   | ✓    |
| 5   | Checking the firewall      | FORWARD を落とす他のファイアウォール（§5）                                                                                                        | ✓    |
| 6   | Preparing workspaces       | ボットの共有ディレクトリの bind mount（nosuid,nodev,nosymfollow）、`~/.ssh/config` の Include                                                     | ✓    |
| 7   | Downloading the base image | GitHub Releases から分割ファイルを取得、sha256 を検査、`incus image import`、別名 `dsh-bot-base`                                                  | ✓    |
| 8   | Installing plugins         | `dsh plugin --profile <p> add @1outres/dsh-bots@<版>`                                                                                             | –    |
| 9   | Testing a VM               | 一時 VM を起動し、vsock で sshd が答えること、VM から HTTPS が通ることを見て消す                                                                  | ✓    |

ステップ 3〜6 の中身は `infra/vm/host-setup.sh <phase>`（`packages` / `incus` / `firewall` / `workspaces`、`all` は全部）。host-setup.sh は root で非対話・冪等に動く単体のスクリプトで、作者が直接使ってもよい。インストーラは各ステップで「済んでいるか」を先に調べ、済んでいれば何もしない。

## 3. OS ごとの差

| OS                    | Incus の入手                                                                                                   | 追加                          | 備考                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Debian 13             | main（6.0.4）                                                                                                  | –                             |                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Debian 12             | Zabbly `lts-6.0`（6.0.7、QEMU と virtiofsd 同梱）。第三者リポジトリなので先に 1 行で尋ねる（非対話なら止まる） |                               | bookworm/backports に virtiofsd が無い（確認済み）                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Ubuntu 24.04          | Zabbly `lts-6.0`（同上）                                                                                       |                               | universe の 6.0.0 は `io.bus=virtiofs` を拒否（確認済み）                                                                                                                                                                                                                                                                                                                                                                                                              |
| Fedora 42+            | 公式（6.23）                                                                                                   |                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Arch                  | extra（7.6）                                                                                                   | qemu-base ほかは incus の依存 |                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| RHEL/Rocky/Alma 9・10 | —                                                                                                              |                               | **対象外**。EPEL 9・10 に incus が無い。Incus の公式ドキュメントが示す COPR `neelc/incus`（EL9・EL10 とも 7.0.0、qemu-kvm と edk2-ovmf を入れた状態）も `neil/incus`（6.8）も「QEMU command not available: qemu-system-x86_64」で VM ドライバが動かない（確認済み）。QEMU を指定する正規の方法は無く、upstream の案内は `/usr/libexec/qemu-kvm` への symlink で、さらに EL の QEMU には Incus の VM が使う SPICE が無い（lxc/incus#1301、未解決）。ステップ 1 で止まる |
| NixOS                 | `virtualisation.incus.enable`                                                                                  | §3.1                          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

どの OS でも `socat`（1.7.4 以上: VSOCK 対応）、`btrfs-progs`、`e2fsprogs`（Incus が `chattr` を使う）、`zstd`（Incus がイメージの取り込みで使う）を入れる（ソケットの ACL をやめるので `acl` は要らない、§7）。パッケージ名は `infra/vm/host-setup.sh` の `phase_packages` にだけ書く。Incus は 6.0.4 以上（`raw.idmap` → virtiofsd の `--translate-uid`、`io.bus=virtiofs`、`security.guestapi` を Debian 13 の 6.0.4 と Zabbly の 6.0.7 で確認）、VM ドライバ（qemu）が使えることを packages の最後に確かめる。

### 3.1 NixOS

/etc の設定は宣言的なので、ステップ 3 は `~/.local/state/dsh-bots/nixos/dsh-bots.nix` を書き出し、次を示して止まる（終了コード 3、「続きは rebuild の後」）:

> imports に ./dsh-bots.nix を足して `sudo nixos-rebuild switch`、そのあともう一度実行

モジュールの中身: `virtualisation.incus.enable`、`networking.nftables.enable`、`users.users.<DSH_USER>.extraGroups = ["incus-admin"]`、`environment.systemPackages = [ socat btrfs-progs ]`、`boot.kernelModules = [ "vhost_vsock" ]`、ボットの共有ディレクトリの `systemd.mounts` と `incus.service` の `RequiresMountsFor`、`networking.firewall.trustedInterfaces = [ "dshbr0" ]`（NixOS のファイアウォールが VM の DHCP/DNS を落とさないように。VM→Host は Incus の ACL が引き続き拒否する）。再実行時は、モジュールの内容が書き出したものと同じで、その結果（incus が動く、グループ、mount）が揃っていればステップ 3 と 6 を済みとし、4 以降は他の OS と同じ incus コマンドで進む。

## 4. WSL2

判別は `/proc/sys/fs/binfmt_misc/WSLInterop` か `uname -r` の `microsoft-standard-WSL2`。ステップ 1 で次を順に確かめ、欠けていればそれぞれ直し方を示して止まる:

1. systemd が PID 1: 無ければ `/etc/wsl.conf` に `[boot] systemd=true` を足し、Windows 側で `wsl.exe --shutdown` してから再実行するよう示して止まる（このステップでは root を取らないので書かない）。
2. `/dev/kvm`: Windows 11 の `%UserProfile%\\.wslconfig` の `[wsl2] nestedVirtualization=true`（Windows 側のファイルなので案内のみ）。
3. カーネルモジュール: `kvm_intel`/`kvm_amd`、`vhost_vsock`、`btrfs`、`bridge` を modprobe し、`/etc/modules-load.d/dsh-bots.conf` に残す（標準カーネル 6.6/6.18 ではいずれも `=m`、virtio-fs は `=y`）。
4. 常駐: WSL は無操作で止まり、ボットの VM も止まる。完了時に `.wslconfig` の `vmIdleTimeout=-1` と、ログオン時に `wsl.exe -d <distro> --exec sleep infinity` を起動するタスクの案内を出す（設定はしない）。

WSL2 はこのホストで試せないので未検証。

## 5. ファイアウォール

VM の通信は Incus の `inet incus` テーブルで許可されても、別のテーブルの forward フックが落とせば止まる。ステップ 5 は次を調べる:

| 検出                                                                                                | 対処（自動）                                                                                                           |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| ufw が active                                                                                       | `ufw allow in on dshbr0`、`ufw route allow in on dshbr0`、`ufw route allow out on dshbr0`                              |
| firewalld が running                                                                                | `--permanent --zone=trusted --add-interface=dshbr0`、reload                                                            |
| Docker（`DOCKER-USER` チェーンがある）                                                              | `dsh-bots-docker-forward.service`（docker.service の後に `DOCKER-USER` へ dshbr0 の 2 規則を入れる）を入れて有効にする |
| それ以外で forward フックの policy が drop の base chain（`nft -j list chains`、`inet incus` 以外） | 何が見つかったかを示して止まる                                                                                         |

いずれも VM→Host の拒否（Incus の ACL）は変えない。iptables-legacy の規則は nft から見えないので、ステップ 9 の HTTPS の確認で見つける（失敗時の案内に含める）。

## 6. DSH のプロファイルとプラグイン

- プロファイル: `${DSH_HOME:-~/.dsh}/profiles/` の一覧。`DSH_BOTS_PROFILE` があればそれ。1 つだけならそれ。複数なら尋ねる（既定 `web`）。端末が無いときに複数なら、`DSH_BOTS_PROFILE` を案内して止まる。プロファイルがまだ無ければ `web`（`dsh plugin` が初回に作る）。
- 入れ方: `dsh plugin --profile <p> add @1outres/dsh-bots@<版>`（中身は pnpm）。プロファイルの `package.json` の `dependencies` に入り、`dsh.profile.bundles` の末尾に `@1outres/dsh-bots` が足される（/tmp の DSH_HOME で確認済み）。
- `@deepseek-ai/dsh-ssh` / `dsh-fs-ssh` / `dsh-subprocess-ssh` は DSH に同梱されず、プロファイルは `autoInstallPeers: false`。`@1outres/dsh-bot-vm` の peerDependencies から dependencies（版ちょうど）に移し、バンドル 1 つで揃うようにする。
- 済みの判定: `dependencies` の版と `bundles` を見る。`@1outres/dsh-bot-*` の個別バンドルが `bundles` にあれば（同じ行 id を入れるので）止まる。
- 試験用: `DSH_BOTS_NPM_REGISTRY`（`--registry` に渡す。Verdaccio など）、`DSH_BOTS_PACKAGE`（`add` に渡す指定そのもの）。
- 最後に DSH の再起動を案内する（プラグインの読み込みと、`incus-admin` グループを DSH のプロセスに持たせるため）。

## 7. host-setup との分担と、合わせて直すもの

- **ゲストの uid**: `provision-base.sh` は `bot` を uid/gid 1001 で明示して作り、ビルダーの cloud-init が作る `debian` ユーザを消す。1001 は既存の VM（`raw.idmap` が 1001）と合わせるための値で、`guestUid` 既定値と同じことを試験で確かめる。
- **vsock の SSH**: `systemd-ssh-proxy`（systemd ≥256）をやめ、`socat` で中継する 1 つの仕組みにする。ProxyCommand は dsh-bot-vm が同梱する `lib/vsock-proxy.js`（Incus の API から `volatile.vsock_id` を引き、`socat STDIO VSOCK-CONNECT:<cid>:22` を exec 相当で起動）を DSH の node の絶対パスで呼ぶ。`ProxyUseFdpass no`。ssh 設定は ensure のたびに書き直されるので、既存のボットは次の起動で移行する。`/usr/local/bin/dsh-bot-vsock-proxy` は host-setup が入れなくなり、どの設定からも参照されなくなったら消す。
- **sudo -n**: host-setup.sh は root で動くスクリプトにし、自分で sudo しない（root でなければ止まる）。sudo はインストーラが最初に 1 回 `sudo -v`（/dev/tty から）で取り、実行中は更新する。
- **ホストの DSH のパス**: DSH の grep/glob はホストで解決した rg の絶対パス（`@deepseek-ai/dsh-util-ripgrep` の `resolveRgPath()`）を VM で spawn する。dsh-bot-vm はそのパスを同じ関数で得て、ensure の最後に VM 内のそのパスを VM の `/usr/bin/rg` への symlink にする（ssh、`sudo -n`、同じなら何もしない）。イメージから DSH の global install を外す（`npm prefix=/usr` の要求も消える）。組み込みスキルは bot-core がボットに渡さないので対象外。
- **owner**: `<stateDir>/owner` に初回に作るランダムな ID。無いとき、`<stateDir>/bots` がある（以前の版のボットがある）なら今の値（実パスのハッシュ）を書いて引き継ぐ。
- **capacity**: `limits.memory` の百分率は Host のメモリに対する割合として読む。
- **Incus ソケット**: `incus-admin` グループだけにする（ACL の drop-in は作らない。以前の版が作った drop-in は自動では消さず、README に手で消す条件を書く）。グループに加えたときと、プラグインを入れたとき、インストーラは最後に 1 行で DSH の再起動を案内する。
- **その他**: legacy forward guard の節、`DSH_USER` の既定（作者のユーザ名）、`snapshots.expiry`、`filter-AAAA` を消す。alias の解決は `incus query /1.0/images/aliases/<alias>`（JSON）。`create-bot-vm.sh` を消し、README の説明に寄せる。

## 8. 状態

- 正は実機の状態（パッケージ、Incus の資源、mount、プロファイルの package.json）。各ステップはまず調べ、済みなら飛ばす。だから途中で止まっても再実行で続きから進む。
- `~/.local/state/dsh-bots/`（`XDG_STATE_HOME`）: `install.env`（選んだプロファイル）、`logs/install-<時刻>.log`、`downloads/`（イメージの分割ファイル。`curl -C -` で再開、検査済みは再取得しない）、`nixos/dsh-bots.nix`。
- 取り込むイメージ・npm の版は `infra/release.env`（`DSH_BOTS_VERSION`、`DSH_VERSION`、`IMAGE_TAG`、`IMAGE_MANIFEST_SHA256`）。`DSH_BOTS_VERSION` と `DSH_VERSION` は `packages/dsh-bots/package.json` の `version` と `engines.dsh` に一致させ、`test/installer.test.ts` が確かめる。`IMAGE_*` は `export-image.sh` が書く。パイプ実行が取るソースの `release.env` が、npm から入れる版（ちょうど）と使うイメージを決めるので、三者はずれない。
- 取るソース: 既定は最新の公開済みリリース（GitHub API `repos/1outres/dsh-bots/releases/latest` の `tag_name`、`v<版>`）。その GitHub リリースは Release ワークフローが npm への公開とイメージの確認を済ませてから作る（タグを push しただけではできない）ので、指す `release.env` は必ず公開済みのものを指す。main が先に進んでも（未公開の版を指す `release.env` がマージされても）影響しない。イメージ用のリリース（`image-*`）は `--latest=false` で作り latest にしない。latest が `v<版>` でなければ（API に届かない、まだリリースが無い、`image-*` が latest になっている）、何が起きたかと `DSH_BOTS_REF=<タグ>` での指定を示して止まる。`DSH_BOTS_REF` を与えればそのタグ（またはブランチ）を取る。API は未認証で 1 時間に 60 回まで。

## 9. イメージの配布

- 作者: `infra/vm/build-base-image.sh` → `infra/vm/export-image.sh <tag>`: `incus image export` した 1 つの tarball を 1900 MiB ごとに分け、`manifest.txt`（各部分の名前・大きさ・sha256、全体の sha256 = Incus の fingerprint、イメージの DSH 版）を作る。アップロードは作者が `infra/vm/publish-image.sh`（gh CLI）で行う: 各部分の sha256 を確かめ、下書きのリリース `<tag>`（latest にしない）に上げて公開し、`check-image-release.sh` で確かめる。途中で切れたら再実行で下書きを仕上げる（手順は `infra/RELEASING.md`）。
- Release ワークフローは公開の前に `infra/vm/check-image-release.sh` で、`IMAGE_TAG` のリリースが公開済みで、その `manifest.txt` の sha256 が `IMAGE_MANIFEST_SHA256`、`dsh` が `DSH_VERSION`、manifest の各部分が同じ大きさで揃っていることを確かめる。一致しなければ npm に何も出さずに止まる。
- インストーラ: manifest を取り `IMAGE_MANIFEST_SHA256` と照合、部分ごとに sha256、つないで全体の sha256 = fingerprint を確かめてから import。`dsh-bot-base` が既にその fingerprint を指していれば何もしない。別のイメージを指していれば別名を新しいものへ 1 回で付け替え、別名の残らない古いイメージは消す。
- 試験用: `DSH_BOTS_IMAGE_URL`（manifest と部分の置き場所。`file://` 可）。

## 10. 出力

- 端末（stdout が tty）のときだけ色。各ステップ 1 行。進行中は `…`、終わったら同じ行を `✓`/`✗`/`–`（済み）で書き換える。詳細はすべてログへ。
- 失敗時だけ 3 行（何が・なぜ・どう直す）とログの場所。
- 入力は /dev/tty から。`DSH_BOTS_NONINTERACTIVE=1`（エージェント向け、[agent-setup.md](../agent-setup.md)）なら端末を読まない。端末が無いとき、第三者リポジトリの確認は「いいえ」なので止まり（`DSH_BOTS_YES=1` で通す）、プロファイルが複数なら止まり（`DSH_BOTS_PROFILE`）、sudo にパスワードが要れば止まる。
- sudo は、ステップ 2 の後（NixOS はステップ 3 の後）に一度だけ理由を 1 行示して `sudo -v`。
- ステップの関数は errexit のサブシェルで動き、失敗したコマンドで止まる。root のスクリプトは `fail`（何が・どう直す）を `DSH_BOTS_REPORT` に書き、それ以外の失敗は ERR trap が「どのコマンドが何行目で」を書く。

成功時:

```
dsh-bots installer 0.3.0
Root access is needed to install packages and set up Incus (sudo).
[sudo] password for alice:
[1/9] Checking system ............ ✓ Ubuntu 24.04, KVM
[2/9] Checking DSH ............... ✓ 0.2.2-rc.5, profile web
[3/9] Installing packages ........ ✓
[4/9] Configuring Incus .......... ✓
[5/9] Checking the firewall ...... ✓ ufw: allowed dshbr0
[6/9] Preparing workspaces ....... ✓
[7/9] Downloading the base image . ✓ 1.6 GiB
[8/9] Installing plugins ......... ✓ @1outres/dsh-bots 0.3.0
[9/9] Testing a VM ............... ✓

Done. Restart DSH to load dsh-bots (log out and in first if you start it from a shell).
```

失敗時:

```
[1/9] Checking system ............ ✓ Debian 12, KVM
[2/9] Checking DSH ............... ✗

  DSH 0.2.2-rc.4 is installed; dsh-bots 0.3.0 needs exactly 0.2.2-rc.5.
  Fix: npm install -g @deepseek-ai/dsh@0.2.2-rc.5, then run this again.
  Log: ~/.local/state/dsh-bots/logs/install-20261124-181500.log
```

## 11. 構成

- `install.sh`（ルート）: 1 ファイル。パイプで実行されたときは `DSH_BOTS_REF`（既定は最新リリースのタグ、§8）のソースの tarball を取り、展開した `install.sh` を `DSH_BOTS_SOURCE=<展開先>` で実行し直す（そのリリースのインストーラ全体が動く）。`DSH_BOTS_SOURCE=<dir>` ならその checkout。表示（`ui_*`）、ステップの関数、状態の読み書きを分けて持つ。
- `infra/vm/host-setup.sh`: root の設定（§2）。`infra/vm/lib.sh`: OS の判別と失敗の報告（`DSH_BOTS_REPORT` のファイルに 3 行）を両方が使う。
- `infra/vm/build-base-image.sh` / `provision-base.sh` / `export-image.sh` / `publish-image.sh`: 作者用。`check-image-release.sh`: 作者と Release ワークフロー。

## 12. 試験

- 静的: `bash -n`、shellcheck（CI が公式のバイナリで実行）、`pnpm test` にパッケージと `release.env` の一致、uid の一致。
- コンテナ: Incus の専用 project `dsh-installer-test`（プール `dsh-installer-test`、ブリッジ `dsh-insttest0`。Incus の project は OVN 無しにブリッジを持てないので、ブリッジだけ default に置き、終わったら消す）に Debian 12/13、Ubuntu 24.04、Rocky 9、Fedora、Arch、NixOS のコンテナを作り、ステップ 1〜6（OS 判別、パッケージ、設定）をそれぞれで実行する。`/dev/kvm` と `/dev/vhost-vsock` を渡したネストしたコンテナで 7〜9（VM 起動）まで試せるか確かめる。
- プラグイン: /tmp の DSH_HOME と Verdaccio（127.0.0.1:4873）でステップ 8、確認用 DSH で ensure（rg の symlink、socat の ProxyCommand、owner）まで。
- WSL2 は未検証として報告する。
