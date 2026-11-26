# Proxmox VE を VM ホストにする spike（使い捨て）

dsh-bots のボット VM を、既存の Proxmox VE に API token だけで置けるかを調べた。本体（packages/）は変えていない。スクリプトは依存なし（Node 24 の標準ライブラリ、ゲスト側は bash と python3）。

この文書では「確認済み」は 2026-11-26〜27 にこのマシンで実際に動かして確かめたこと、「未検証」は試していないこと、「推測」は根拠が文書や読んだコードだけのことを指す。

## 0. 結論

- **API token だけで足りる操作**（確認済み）: イメージの取り込みとテンプレート化、VM の作成（linked clone）・設定・起動・停止・削除、cloud-init の user-data（ISO を作ってアップロード）、VM と別寿命のワークスペース、ディスクの拡張（動いたままでも）、VM 単位のファイアウォール、ゲストへの SSH（シリアル経由、または VM の IP へ直接）。ノードへの SSH は要らない。
- 管理者が root で一度だけ行うこと（§2）: ストレージ・プール・ロール・ユーザ・token・ACL の作成、**データセンターのファイアウォールの有効化**。Incus の形 3 の `create-project.sh` に当たる。
- **ゲストへの経路の推奨は (b) VM の IP へ直接 SSH**。Incus の exec のような「ゲストが何も listen しない」経路は Proxmox の API には無い。
  - (a) シリアル（`serial1: socket` + termproxy + vncwebsocket）は API だけで双方向のバイト列になり、SSH も通った（確認済み）。しかし **このマシンでは 0.6〜1.2 KiB/s**、`ssh 'true'` が 14 s で、ボットの道具には使えない。遅さは 16550 UART の 1 バイトごとの I/O の exit で、入れ子が深いほど悪い（§3.1）。素の Proxmox でどこまで速いかは未検証。
  - (b) は 32 MiB が下り 11.6 MiB/s・上り 7.9 MiB/s、`ssh 'true'` 492 ms（確認済み、入れ子 3 段）。代わりに **DSH ホストから VM のネットワークへの経路**と、ゲストの sshd の listen、VM ファイアウォールの受け入れ規則（DSH ホストの IP だけ）が要る。
  - (c) qemu-guest-agent の exec / file-read / file-write は一括の API で、exec 1 回 360〜790 ms、file-write は 1 回 60 KB まで。トンネルには向かない。IP を知る手段（`agent/network-get-interfaces`）としては使える。
- シリアルを使う場合でも、制御用（IP が取れない・ネットワークが壊れた VM の検査）の補助には使える。そのときは素の `sshd -i` ではなく §3.1 の枠付きの relay が要る。

## 1. 環境（すべて片付け済み、§9）

| もの         | 中身                                                                                                                                                                                                                                                                                    |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 入れ子の PVE | このマシン（それ自体が KVM のゲスト）の Incus に project `pve-spike`、VM `pve1`（Debian 13 → Proxmox VE 9.3.1、pve-manager 9.3.1、kernel 7.0.14-30-pve、QEMU 11.1.3、6 vCPU / 12 GiB / 60 GiB）。ストレージプール `pvespike`（btrfs 70 GiB）、ブリッジ `pvespk0`（10.250.77.0/24、NAT） |
| PVE の中     | `vmbr0`（enp5s0 をブリッジ）、dir ストレージ `dshbots`（`/var/lib/dsh-bots`、content `images,import,iso,snippets`）、プール `dsh-bots`、ロール `DshBots`、ユーザ `dsh-bots@pve`、token `dsh-bots@pve!plugin`（privsep=1）                                                               |
| ボット VM    | 101 `bot-a`（2 vCPU / 2 GiB、テンプレート 9000 の linked clone）。ボット VM は L3（このマシン → pve1 → bot-a）なので、**数値はどれも実機より大幅に遅い**（推測）                                                                                                                        |

PVE の入れ方: `install-pve.sh`（Debian 13 に pve-no-subscription の apt で `proxmox-ve`）。途中で `incus exec` の websocket が切れたので後半は `post-install-pve.sh` を `systemd-run` で流した。`/etc/network/interfaces` が PVE のパッケージに書き戻され、`vmbr0` を書き直して `ifreload -a` した。

## 2. 管理者の準備と権限

`admin-setup.sh`（ノードの root で 1 回）:

- dir ストレージ `dshbots` を作り、プール `dsh-bots` にストレージとして入れる。
- ロール `DshBots`: `VM.Allocate VM.Audit VM.Clone VM.Config.CDROM VM.Config.CPU VM.Config.Cloudinit VM.Config.Disk VM.Config.HWType VM.Config.Memory VM.Config.Network VM.Config.Options VM.Console VM.PowerMgmt VM.GuestAgent.Audit Datastore.Audit Datastore.AllocateSpace Datastore.AllocateTemplate Pool.Audit SDN.Use`。
- ACL: `/pool/dsh-bots` に `DshBots`、`/sdn/zones/localnetwork/vmbr0` に `PVESDNUser`。privsep の token はユーザの権限との積なので、ユーザと token の両方に付ける。
- 後から: `pvesm set dshbots --content images,import,iso,snippets`（iso を足した、§5）、`pvesh set /cluster/firewall/options --enable 1`（§7）。

確認済み（`matrix.mjs`、`results/matrix.txt`）:

| 操作                                                                                                                   | 可否                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| プールの VM の作成（`pool` を付けたときだけ）・clone・設定・起動・停止・削除、termproxy、VM のファイアウォール         | 可                                                                       |
| `pool` を付けない VM の作成                                                                                            | 拒否（403）                                                              |
| プール外の VM（root が作った 500）の参照・停止・設定・削除・termproxy                                                  | 拒否 `/vms/500`                                                          |
| プール外のストレージ（`local`）の参照・割り当て                                                                        | 拒否 `Datastore.AllocateSpace`                                           |
| 許していないブリッジ（`vmbr9`）の NIC                                                                                  | 拒否 `SDN.Use`                                                           |
| `args`、`hostpci`、実デバイスの `serial0: /dev/ttyS0`                                                                  | 拒否 "only root can set …"                                               |
| ストレージの設定の参照・変更・作成、ノードのネットワークの作成、ノードの shell（termproxy）・`execute`・syslog・status | 拒否                                                                     |
| ACL の変更、プールへの VM の追加                                                                                       | 拒否 `Permissions.Modify` / `Pool.Allocate`                              |
| スナップショット                                                                                                       | 拒否 `VM.Snapshot`                                                       |
| ノードのネットワーク一覧（`GET /nodes/<n>/network`）、`/cluster/resources`（見える VM だけ）                           | 可                                                                       |
| ISO・import の**削除**（`DELETE …/content/<volid>`）                                                                   | 拒否 `Datastore.Allocate`（同じ名前での上書きのアップロードは可）        |
| VM の qemu-guest-agent の exec                                                                                         | 拒否 `VM.GuestAgent.Unrestricted`（§3.3 の測定のときだけ一時的に足した） |

- vzdump（`POST /nodes/<n>/vzdump`）は受け付けられて task になり、`dshbots` が backup の content でないため失敗した。権限の検査で止まったのではない。**未検証**: backup の content を持つストレージがプールにあるときに token でバックアップが取れるか（取れるなら `VM.Backup` を外していても漏れる道）。
- **注意（確認済み）**: `Datastore.AllocateSpace` だけで、存在しない vmid（例 1101）の持ち主のボリュームを割り当てられた。token はそのボリュームを一覧で見られず、消せず、VM に付けられない（`/vms/1101` の `VM.Config.Disk`）。容量の取り合いにはなるので、管理者の片付けの手順に入れる。
- Incus の制限付き証明書と違い、token は自分の VM のファイアウォールを外せる（`enable: 0`）。token が漏れたら egress の遮断も失う。§7。

## 3. ゲストへの経路

### 3.1 (a) シリアル + termproxy

仕組み（確認済み）:

1. `POST /nodes/<n>/qemu/<vmid>/termproxy {serial: "serial1"}` → `{port, ticket, user}`（権限は `VM.Console`）。
2. `GET /nodes/<n>/qemu/<vmid>/vncwebsocket?port=…&vncticket=…`（token のヘッダ付き、subprotocol `binary`）。
3. 最初に `<user>:<ticket>\n` を送ると `OK` が返る。以後、入力は `0:<バイト数>:<バイト列>`、ping は `2`。出力は生のバイト列。
4. ノードでは termproxy が pty の上で `qm terminal <vmid> -escape 0 -iface serial1` を動かし、それが `socat UNIX-CONNECT:/var/run/qemu-server/<vmid>.serial1 STDIO,raw,echo=0` を起動する（`/usr/share/perl5/PVE/API2/Qemu.pm`、`PVE/CLI/qm.pm` を読んで確認）。エスケープ文字は無効。

分かったこと:

- 出力の頭に `starting serial terminal on interface serial1\r\n` が来る。その前に送った入力は、socat が pty を raw にする前なので**エコーされ、改行が `\r\n` になる**（確認済み）。バナーを見てから 300 ms 待って送ると、以後のバイト列はエコーも変換も無く通った。
- イメージの kernel は `console=tty1 console=ttyS0` で起動する（grub.cfg、確認済み）。ttyS0 には kernel のメッセージと getty が出るので、データには `serial1`（ttyS1）以降を使う。
- **1 本のシリアルに同時につながるのは 1 本だけ**（確認済み）。2 本目の termproxy は認証とバナーまで進み、1 本目が切れるまで待たされた（34 s 後に開いた）。QEMU の `socket,server=on` の chardev が 1 接続しか受けないため（推測）。シリアルは VM に 4 本（serial0〜3）まで。
- 素の `sshd -i` を ttyS1 につなぐ形（`guest/dsh-serial-ssh`、ホスト側 `serial-proxy.mjs`）は、1 回目は通ったが**切断を知る手段が無い**。ssh 側が途中で消えると、ゲストの sshd は次の接続の `START` 行を SSH の識別行として読んで "Invalid SSH identification string" を返し、2 回目以降の接続が壊れた（確認済み）。
- そこで `guest/dsh-serial-relay`（python3）を作った。COBS で符号化して 0x00 で区切った枠（種類・チャネル・中身）で、チャネルごとに `sshd -i` を起動する。新しい接続はまず 0x00 を送れば必ず枠の境目に戻れ、同じチャネルの `OPEN` は古い sshd を殺す。ホスト側は `serial-mux-proxy.mjs`。
  - ssh を途中で kill した直後の再接続が通った（確認済み、`results/reconnect.txt`）。
  - 1 本の ControlMaster の上の多重化（`-S`）は通った（確認済み）。チャネルを分ければ 1 本の termproxy に複数の SSH 接続を載せられる形だが、ホスト側を 1 本の termproxy に集める中継（Incus の §5.2 のプロセス内の中継と同じ置き場所）は作っていない（未検証）。
- 速さ（確認済み、`results/bench-small.txt`、`results/bench-mux.txt`）: `ssh 'true'` が接続込みで 13.7〜14.2 s（termproxy の起動とバナーまでが約 2 s、残りは鍵交換のバイト数）、ControlMaster の確立 10.8〜15.2 s、多重化の `true` 0.45〜2.8 s、16 KiB 下り 13.6 s（1.2 KiB/s）、上り 29 s（0.6 KiB/s）、64 KiB 下り 80 s（0.8 KiB/s）。32 MiB は測っていない（この速さで約 9 時間）。
- 遅さの原因（確認済み）: ボット VM の中で `head -c 4096 /dev/zero > /dev/ttyS2` が 3.8 s（約 1 KiB/s、だれもつながっていない chardev でも同じ）。pve1（L2）の ttyS0 では 16 KiB が 9600 / 38400 / 115200 baud のどれでも約 1.2 s（約 14 KiB/s）で、baud に比例しない。QEMU が baud で絞っているのではなく、16550 の 1 バイトごとの port I/O の exit が入れ子で重い。素の Proxmox（ボット VM が L1）での速さは**未検証**。exit 1 回 1〜2 µs なら数百 KiB/s〜1 MiB/s 程度（推測）で、それでも Incus の exec（32 MiB を 1.3〜2.7 s）より 1 桁以上遅い。
- virtio-serial（速いはず）は PVE の設定に無く、`args` は root だけ（確認済み）なので token では使えない。

### 3.2 (b) VM の IP へ直接

- ゲストで `sudo /usr/sbin/sshd -p 2222`（spike では (a) の経路から起動した）、VM のファイアウォールに `in ACCEPT source=<DSH ホストの IP> tcp 2222` を token で足し、DSH ホストから `ssh -p 2222 bot@<VM の IP>` で通った（確認済み）。
- 速さ（確認済み、`bench.sh`、`results/bench-ip.txt`）: `ssh 'true'` 接続込み 10 回の平均 492 ms、ControlMaster 越し 79 ms、32 MiB 下り 2.77 s（11.6 MiB/s）、上り 4.03 s（7.9 MiB/s）、多重化で `sleep 2` を 4 本同時に 2.19 s。
- VM の IP は qemu-guest-agent の `GET …/agent/network-get-interfaces` で読めた（`VM.GuestAgent.Audit`、確認済み）。イメージに qemu-guest-agent は入っていない（確認済み）ので、spike では cloud-init の `packages` で入れ、VM の設定に `agent: enabled=1`。PVE の SDN の IPAM（DHCP）から引く手は未検証。
- 要るもの: DSH ホストから VM のネットワークへの経路（同じ L2、ルーティング、VPN のどれか。管理者の責任）、ゲストの sshd の TCP の listen（今のイメージは `ssh.service` / `ssh.socket` を mask している、`provision-base.sh`）。ホスト鍵の固定は今と同じ（HostKeyAlias、cloud-init でホスト鍵を入れる、§5）。
- 他の VM からの SSH は VM の in の既定 DROP と §7 の out の拒否で止まる（推測。VM を 2 台並べての確認はしていない）。

### 3.3 (c) qemu-guest-agent

- `POST …/agent/exec` + `GET …/agent/exec-status?pid=` で `/bin/true` が 362〜788 ms（確認済み、`agent-probe.mjs`）。`VM.GuestAgent.Unrestricted`（= VM の中で root で何でも）が要る。
- `POST …/agent/file-write` は 1 回 60 KB で 271 ms（確認済み）。`file-read` は 1 MiB のファイルで 48 バイトしか返らなかった（原因は追っていない）。
- ストリームが無く、1 回ごとに API の往復と task があるので SSH の土台には向かない（推測）。

### 3.4 その他

- noVNC / SPICE（`vncproxy`、`spiceproxy`）は画面の経路で、バイト列の経路にならない（推測）。
- ノードの shell（`POST /nodes/<n>/termproxy`）は `Sys.Console`（= ノードの root）で、token には渡せない。

## 4. イメージ

- 統合 tarball の `rootfs.img` は qcow2（10 GiB、1.38 GiB、UEFI の GPT、確認済み）。PVE には tarball のまま渡せない。DSH ホストで取り出す: `extract-qcow2.mjs`（Node 24 の `zlib.createZstdDecompress` と自前の tar の読み取り）で 30.2 s、`tar` で取り出したものと sha256 が一致（確認済み）。
- `POST /nodes/<n>/storage/dshbots/upload`（multipart、`content=import`、`Datastore.AllocateTemplate`）で 1.39 GiB が 24.4 s（58 MiB/s）、その後の task（`imgcopy`）込みで 38.1 s（確認済み、`upload.mjs`）。pveproxy はまずノードの `/var/tmp` に受けてから移すので、ノードにも同じだけの空きが要る（推測。task 名と所要時間から）。
- `POST /nodes/<n>/qemu`（`scsi0: dshbots:0,import-from=dshbots:import/<file>.qcow2`、`bios: ovmf`、`efidisk0 … pre-enrolled-keys=0`、`machine: q35`、`scsihw: virtio-scsi-single`、`serial0: socket`）で 70.9 s、`POST …/template` で 1.3 s（確認済み、`template.mjs`）。
- `POST …/qemu/9000/clone {newid, pool, full: 0}`（linked clone）が 1.5〜2.5 s（確認済み）。テンプレートの base ボリュームは、linked clone が残っている間は消せない（推測、PVE の仕様）。イメージの版を上げるときは新しいテンプレートを作り、古いものは clone が無くなってから消す。
- `download-url`（PVE に直接取らせる）は 403（`Sys.Modify` 相当が要る、確認済み）。
- import の削除は `Datastore.Allocate` が要る（§2）。
- 起動から cloud-init の終わりまで約 3 分（L3 の入れ子、確認済み）。

## 5. cloud-init

- **snippets のアップロードはできない**: `upload` の `content` は `iso, vztmpl, import` だけ（"value 'snippets' does not have a value in the enumeration"、確認済み）。`cicustom` は使えない。
- PVE の組み込みの cloud-init（`ciuser`、`sshkeys`、`ipconfig0`）は authorized_keys までで、ホスト鍵・`mounts`・`write_files`・`runcmd` を渡せない（推測、PVE の文書）。
- 代わりに **NoCloud の ISO を DSH ホストで作り、`content=iso` でアップロードし、`ide3` の CD-ROM として付けた**（`iso.mjs` は依存なしの最小の ISO 9660 の書き手、ボリューム名 `cidata`）。PVE の cloud-init ドライブ（`ide2`）は外す。今の `cloud-init.ts` と同じ user-data（ユーザ、authorized_keys、ed25519 のホスト鍵、`mounts`、`runcmd`）がそのまま効いた（確認済み）。
  - `network-config` で NIC を名前の glob（`en*`）で選ぶと、cloud-init は `Name=nic` の networkd の設定を書き、NIC がつながらなかった（確認済み）。clone の後に `net0` の MAC を読み、`match: {macaddress}` にして通った。
  - 同じ名前の ISO の上書きのアップロードは通る。削除はできない（§2）。ISO にはホスト鍵の秘密鍵が入るので、初回の起動の後に CD-ROM を外し（`delete: ide3`、動いている VM では次の起動で効く pending になった）、同じ名前で秘密の無い ISO を上書きした（確認済み、ノードで `PRIVATE` が 0 件）。ISO はノードの root とストレージの管理者には読める（Incus の `cloud-init.user-data` と同じ扱い、推測）。

## 6. ワークスペース（VM と別寿命のディスク）

- PVE のボリュームは名前で持ち主の vmid が決まり（`vm-<vmid>-…`）、VM の削除（`purge=1`）は自分の持ち物を設定から外したもの（`unusedN`）も含めて消す（確認済み。VM 101 の `vm-101-workspace.raw` は `unused0` になった後、VM の削除で消えた）。
- **持ち主を別の VM にする**: プールの中に起動しない「保管用」の VM（190 `dsh-bots-volumes`）を作り、ワークスペースは `POST /nodes/<n>/storage/dshbots/content {vmid: 190, filename: "vm-190-ws-<bot>.raw", size}` で割り当て、ボット VM の `virtio1: dshbots:190/vm-190-ws-<bot>.raw,serial=dsh-workspace` に付ける（確認済み、`workspace-probe.mjs`）。
  - ボット VM を `purge=1&destroy-unreferenced-disks=1` で消してもボリュームは残った。持ち主が違うボリュームは消さない（確認済み）。
  - 作り直した VM に付け直すと中身（`persist.txt`）が残っていた（確認済み、2 回）。
  - 外す: ボット VM の設定から `delete: virtio1` で参照が消えるだけ（`unusedN` にならない、確認済み）。
  - 消す: `Datastore.Allocate` を持たないので直接は消せない。保管用の VM に一度付けて（`virtio15`）、`delete: virtio15` で `unused0` にし、`delete: unused0` で消えた（確認済み、`workspace-delete.mjs`）。
- ゲストでは `/dev/disk/by-id/virtio-dsh-workspace` で見える（確認済み）。virtio-scsi で `serial=` を付けても、PVE が `device_id=drive-scsi1` を付けるので `scsi-0QEMU_QEMU_HARDDISK_<serial>` は作られず、mount が "Can't lookup blockdev" で失敗した（確認済み）。fstab の行は今の `WORKSPACE_MOUNT_OPTIONS` のまま、`x-systemd.makefs` で初回だけ ext4 が作られた（確認済み）。
- 拡張: `PUT …/resize {disk: "virtio1", size: "+1G"}` が**動いている VM でも**通り、ゲストの `/dev/vda` が 5 GiB になり、`resize2fs` で `df` が 3.9G → 4.9G（確認済み）。Incus（止めてから）より楽。止めた VM でも通った（確認済み）。

## 7. ネットワークの遮断

- VM のファイアウォールは token で設定・参照できる（`/nodes/<n>/qemu/<vmid>/firewall/options`、`…/rules`、`…/ipset`、`VM.Config.Network`、確認済み、`firewall-probe.mjs`）。`net0` に `firewall=1`。
- 効かせるにはデータセンターのファイアウォールが有効であること（管理者、`Sys.Modify`）。token からはその状態を読めない（`/cluster/firewall/options` が `Sys.Audit` で 403、確認済み）。Incus の §6.4 と同じく、**VM の中からの実測で確かめる**しかない。
- spike の規則: options `enable=1, policy_in=DROP, policy_out=ACCEPT, ipfilter=1, macfilter=1, dhcp=1`、out の先頭に `ACCEPT udp 53 → ゲートウェイ`、続けて `REJECT` で `10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`100.64/10`。VM の中からの probe（`guest/egress-probe.sh`）で、ゲートウェイの 22・ノードの 8006 と 22・`169.254.169.254:80` が拒否され、`1.1.1.1:443` と外の HTTPS は通った（確認済み、`results/egress-probe.txt`）。
  - `ipfilter=1` で `ipfilter-net0` の ipset が空・無いと、VM の送信が**すべて**落ちた（確認済み、iptables に `! --match-set PVEFW-101-ipfilter-net0-v4 src -j DROP`）。IP を知ってから ipset に入れる必要がある（spike ではゲストエージェントで読んだ IP を入れた）。DHCP の IP が変わると通信が止まるので、IP を固定するか ipfilter を使わない判断が要る。
  - VM の削除（`purge=1`）でファイアウォールの設定（`/etc/pve/firewall/<vmid>.fw`）も消える（確認済み。作り直した VM で規則が空だった）。作るたびに書く。
  - 他の VM への接続は `10/8` の拒否で止まる（同じサブネット）。VM を 2 台並べての確認はしていない（未検証）。
- token は自分の VM の規則を外せる（§2）。管理者が token の外で守るなら、データセンターの security group を VM に掛けさせない作りにはできない（VM の規則は token が書き換えられる）ので、PVE 9 の SDN の VNet のファイアウォール（forward）か、ブリッジの外側で止める必要がある（推測、未検証）。

## 8. 容量

- token で読めるもの（確認済み）: `GET /pools/dsh-bots`（メンバーの VM の `maxcpu`/`maxmem`/`maxdisk` と、ストレージの `disk`/`maxdisk`）、`GET /nodes/<n>/storage/dshbots/status`（`total`/`used`/`avail`）、VM の `status/current`・`rrddata`。
- 読めないもの: ノードの CPU・メモリ（`/nodes/<n>/status` が `Sys.Audit` で 403。`/cluster/resources` の node にも `maxcpu`/`maxmem` が出ない、確認済み）。
- PVE のプールには CPU・メモリの上限が無い（推測、9.3 の API に該当の項目が見当たらない）。Incus の project の `limits.*` に当たるものは、管理者の申告（例 プールの `comment` に書く、または dsh-bots の設定）で持つしかない。ノードの大きさが要るなら `/nodes/<n>` に `Sys.Audit`（読み取りだけ）を足す。

## 9. VmBackend の Proxmox 実装に要る API

| 用途             | API（すべて `/api2/json`、ヘッダ `Authorization: PVEAPIToken=<user>!<id>=<secret>`）                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 接続の検査       | `GET /version`、`GET /access/permissions`（自分の権限の一覧）、`GET /pools/<pool>`、`GET /nodes/<n>/storage/<s>/status`                                                 |
| TLS              | ノードの証明書は自己署名。`GET /nodes` の `ssl_fingerprint` と同じ sha256 を固定する（Incus の §4 と同じ考え）                                                          |
| task             | 変更の多くは UPID を返す。`GET /nodes/<n>/tasks/<upid>/status`（`exitstatus`）、失敗の理由は `…/log`                                                                    |
| イメージ         | `POST /nodes/<n>/storage/<s>/upload`（`content=import`）、`GET …/content?content=import`、`POST /nodes/<n>/qemu`（`import-from`）、`POST /nodes/<n>/qemu/<id>/template` |
| VM               | `GET /cluster/nextid`、`POST /nodes/<n>/qemu/<tmpl>/clone`（`pool`、`full: 0`）、`POST/PUT /nodes/<n>/qemu/<id>/config`、`PUT …/resize`、`POST …/status/start           | stop | shutdown`、`GET …/status/current`、`DELETE /nodes/<n>/qemu/<id>?purge=1`、`GET …/pending` |
| cloud-init       | `POST /nodes/<n>/storage/<s>/upload`（`content=iso`）、VM の `ide3`                                                                                                     |
| ワークスペース   | `POST /nodes/<n>/storage/<s>/content`（保管用の vmid）、`GET …/content?vmid=`、VM の `virtioN`、`PUT …/resize`、保管用 VM の設定（削除）                                |
| ネットワーク     | `GET/PUT /nodes/<n>/qemu/<id>/firewall/options`、`GET/POST/DELETE …/firewall/rules`、`…/firewall/ipset`、`GET …/agent/network-get-interfaces`                           |
| ゲストの経路 (a) | `POST /nodes/<n>/qemu/<id>/termproxy`、`GET …/vncwebsocket`                                                                                                             |

## 10. 未検証のこと

- 素の Proxmox（入れ子なし）でのシリアルの速さ。ここで実用になる速さが出るなら、(a) を主にし (b) を要らなくできる。
- クラスタ（複数ノード）。termproxy はノードをまたぐと PVE が内部で SSH する（`Qemu.pm` の `remote_node_ip`、読んで確認）。VM の置き場所の選び方。
- ZFS / LVM-thin / Ceph のストレージでの import-from・linked clone・保管用 VM の持ち物の扱い（dir + qcow2 / raw だけで確かめた）。
- VM の再起動・PVE の `pveproxy` の再起動での SSH の振る舞い（Incus の §8.2 に当たるもの）。
- token の期限（`expire`）と作り直しの手順。
- VM を 2 台並べての VM 間の遮断、IPv6。
- ベースイメージを Proxmox 用に変えるもの（推測）: `qemu-guest-agent` を入れる、sshd の TCP の listen（(b) を使うなら）、または `dsh-serial-relay` の unit（(a) を使うなら）、ワークスペースの by-id。

## 11. ファイル

| file                                                           | what                                                                                                                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| setup-incus.sh / teardown-incus.sh                             | Incus の project・プール・ブリッジ・VM の作成と片付け                                                                                                                                                                   |
| install-pve.sh / post-install-pve.sh                           | VM の中で Debian 13 → PVE 9                                                                                                                                                                                             |
| admin-setup.sh                                                 | ノードの root で 1 回: ストレージ・プール・ロール・token・ACL                                                                                                                                                           |
| pve.mjs                                                        | PVE の REST クライアント（token、証明書の sha256 の固定、task の待ち、最小の websocket）。接続先は `$PVE_ENDPOINT`（既定 `/var/tmp/pve-spike/endpoint.json`、`{url, node, pool, storage, bridge, token, fingerprint}`） |
| get.mjs                                                        | `node get.mjs '<METHOD> <path>' …`: 任意の API を token で叩いて結果を表示                                                                                                                                              |
| fetch-image.sh / extract-qcow2.mjs / upload.mjs / template.mjs | `fetch-image.sh <dir>`（release.env の版を検査付きで取得）、`extract-qcow2.mjs <tar.zst> <out>`、`upload.mjs <file> <import\|iso> [name]`、`template.mjs <vmid> <import の volid>`                                      |
| iso.mjs                                                        | NoCloud の ISO 9660 を作る                                                                                                                                                                                              |
| create-bot.mjs / destroy-bot.mjs                               | `create-bot.mjs <vmid> <name> [GiB]`: ボット VM の作成（clone、ISO、ワークスペース、シリアル）。`destroy-bot.mjs <vmid> keep`: 削除（ワークスペースは残す）                                                             |
| workspace-probe.mjs / workspace-delete.mjs                     | ワークスペースの持ち主の実験と、保管用 VM を使った削除                                                                                                                                                                  |
| firewall-probe.mjs / guest/egress-probe.sh                     | VM のファイアウォールの設定と、VM の中からの到達の検査                                                                                                                                                                  |
| matrix.mjs                                                     | token でできること・できないこと                                                                                                                                                                                        |
| serial-dump.mjs                                                | termproxy の生の出力を見る                                                                                                                                                                                              |
| serial-proxy.mjs / guest/dsh-serial-ssh*                       | 素の `sshd -i` をシリアルにつなぐ最初の形（切断で壊れる、§3.1）                                                                                                                                                         |
| serial-mux-proxy.mjs / guest/dsh-serial-relay*                 | COBS の枠でチャネルごとに `sshd -i` を動かす形。ProxyCommand は `node serial-mux-proxy.mjs termproxy <vmid> <serialN> <channel>`（`SERIAL_PROXY_DEBUG=1` で時刻を出す）                                                 |
| node-direct-proxy.sh                                           | ノードの root で termproxy を通さずにシリアルにつなぐ（調査用）                                                                                                                                                         |
| agent-probe.mjs                                                | qemu-guest-agent の exec / file の往復                                                                                                                                                                                  |
| bench.sh / bench-small.sh / reconnect.sh                       | `bench.sh <ssh_config> <alias> [MiB]`、`bench-small.sh <ssh_config> <alias> <KiB…>`、`reconnect.sh <ssh_config> <alias>`: 往復・転送・多重化・再接続の測定                                                              |
| ppm2png.mjs                                                    | 起動しない VM を調べるため、ノードの `qm monitor` の screendump を PNG にする（調査用）                                                                                                                                 |
| results/                                                       | 生の結果                                                                                                                                                                                                                |

## 12. 片付け（2026-11-27 に済み）

- Incus: project `pve-spike`（VM `pve1`、その中の PVE・ボット VM・テンプレート・ストレージ・token ごと）、ストレージプール `pvespike`、ブリッジ `pvespk0` を消した。`incus project list`・`network list`・`storage list` に残っていないことを確かめた。default / dsh-bots / dsh-mv とその中の VM、`dshbr0`、ホストのネットワークの設定には触れていない。
- ファイル: `/var/tmp/pve-spike/`（イメージ、鍵、token を含む endpoint.json）と `/var/tmp/pve-spike-install.log`、`/tmp` の一時ファイルを消した。
- このマシンで行ったこと: `nbd` モジュールの読み込み（イメージの中身を見るため。`qemu-nbd -d` で外し、`modprobe -r nbd` で戻した）、`/mnt` への ISO のループ mount（外した）。
