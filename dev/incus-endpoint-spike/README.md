# incus-endpoint spike（使い捨て）

docs/specs/incus-endpoint.md の spike に使ったコード。本体（packages/）には入れない。依存なし（Node 24 の標準ライブラリのみ）。bench.mjs だけは main worktree の packages/dsh-bot-vm/node_modules にある dsh-ssh / dsh-fs-ssh / dsh-subprocess-ssh を絶対パスで読む。

| file                              | what                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| incus.mjs                         | Incus REST クライアント（Unix ソケット / HTTPS + クライアント証明書 + サーバ証明書の sha256 固定）、最小の RFC 6455 websocket                                   |
| pair.mjs                          | trust token（`incus config trust add --restricted --projects …`）で自分の証明書を登録する（`incus remote add <token>` 相当）                                    |
| upload-image.mjs                  | 統合 tarball を `POST /1.0/images` で取り込み、alias を付ける                                                                                                   |
| matrix*.mjs                       | 制限付き証明書でできること・できないことの一覧                                                                                                                  |
| provision.mjs                     | ボット相当の VM（ワークスペース = block の custom volume）を作る                                                                                                |
| exec-proxy.mjs                    | ssh の ProxyCommand: `POST /1.0/instances/<vm>/exec`（interactive=false）で `/usr/sbin/sshd -i` を起動し、fd 0/1/2 の websocket を stdin/stdout/stderr につなぐ |
| bench.mjs                         | 本物の SshConnection + BotVmFileSystem + SshSubprocessRuntime を組み、往復・転送・同時接続を測る                                                                |
| restart-incusd.sh / restart-vm.sh | 生きた SSH を張ったまま incusd / VM を再起動する                                                                                                                |

実行環境: このホスト（Debian 13, Incus 6.0.4, 8 vCPU / 64 GiB, このホスト自体が KVM のゲスト（systemd-detect-virt: kvm、VM は入れ子の KVM））。VM は 2 vCPU / 2 GiB、イメージは dsh-bot-base（9fa1dfcf…）。

## 生の結果（2026-11-25）

### bench.mjs（spk-a = exec+HTTPS 制限付き証明書、spk-a-local = exec+Unix ソケット、spk-a-vsock = 今の vsock+socat）

```
=== spk-a
handshake(ready) 660ms
fs.stat RTT x50 p50=2.5ms p95=3.5ms max=5.4ms
spawn true x10 p50=183.7ms p95=260.9ms max=260.9ms
fs.writeText/streamText 4MiB: write 508ms (7.9 MiB/s), read 332ms (12.0 MiB/s) ok=true
fs.writeText/streamText 16MiB: write 1218ms (13.1 MiB/s), read 878ms (18.2 MiB/s) ok=true
fs.writeText/streamText 32MiB: write 2674ms (12.0 MiB/s), read 1825ms (17.5 MiB/s) ok=true
subprocess stdout 64MiB: 1084ms (59.0 MiB/s) bytes=67108864
subprocess stdin 32MiB: 711ms (45.0 MiB/s) remote=33554432
subprocess sample: "ripgrep 14.1.1\ntotal 86040\ndrwxr-xr-x 3 bot  bot      4096 Nov 25 02:08 .\ndrwx--" {"exitCode":0,"signal":null}
8 parallel connections: all ready in 2955ms (each 2951,2606,2947,2788,2908,2307,2809,2936); 20 stats each 316ms, p50=13.0ms p95=27.3ms max=56.3ms
=== spk-a-local
handshake(ready) 592ms
fs.stat RTT x50 p50=2.3ms p95=3.2ms max=6.5ms
spawn true x10 p50=174.4ms p95=244.7ms max=244.7ms
fs.writeText/streamText 4MiB: write 402ms (9.9 MiB/s), read 254ms (15.7 MiB/s) ok=true
fs.writeText/streamText 16MiB: write 992ms (16.1 MiB/s), read 809ms (19.8 MiB/s) ok=true
fs.writeText/streamText 32MiB: write 1314ms (24.4 MiB/s), read 1562ms (20.5 MiB/s) ok=true
subprocess stdout 64MiB: 1229ms (52.1 MiB/s) bytes=67108864
subprocess stdin 32MiB: 653ms (49.0 MiB/s) remote=33554432
subprocess sample: "ripgrep 14.1.1\ntotal 86040\ndrwxr-xr-x 3 bot  bot      4096 Nov 25 02:08 .\ndrwx--" {"exitCode":0,"signal":null}
8 parallel connections: all ready in 2364ms (each 1742,2269,2228,2356,2166,2323,2336,2220); 20 stats each 332ms, p50=16.3ms p95=27.2ms max=40.6ms
=== spk-a-vsock
handshake(ready) 621ms
fs.stat RTT x50 p50=2.0ms p95=3.2ms max=4.8ms
spawn true x10 p50=188.1ms p95=279.4ms max=279.4ms
fs.writeText/streamText 4MiB: write 432ms (9.3 MiB/s), read 225ms (17.8 MiB/s) ok=true
fs.writeText/streamText 16MiB: write 841ms (19.0 MiB/s), read 962ms (16.6 MiB/s) ok=true
fs.writeText/streamText 32MiB: write 1160ms (27.6 MiB/s), read 1256ms (25.5 MiB/s) ok=true
subprocess stdout 64MiB: 789ms (81.1 MiB/s) bytes=67108864
subprocess stdin 32MiB: 603ms (53.0 MiB/s) remote=33554432
subprocess sample: "ripgrep 14.1.1\ntotal 86040\ndrwxr-xr-x 3 bot  bot      4096 Nov 25 02:09 .\ndrwx--" {"exitCode":0,"signal":null}
8 parallel connections: all ready in 2222ms (each 2068,2165,2198,2215,2183,1881,2194,2120); 20 stats each 245ms, p50=10.1ms p95=20.6ms max=40.3ms
spk-a connect+true avg 346ms
spk-a down 256MiB 78 MiB/s
spk-a up 256MiB 78 MiB/s
spk-a-local connect+true avg 292ms
spk-a-local down 256MiB 77 MiB/s
spk-a-local up 256MiB 87 MiB/s
spk-a-vsock connect+true avg 295ms
spk-a-vsock down 256MiB 99 MiB/s
spk-a-vsock up 256MiB 116 MiB/s
```

### restart-vm.sh

```
restart at 1795572932.825108146
incus restart returned 2.28041s
spk-a-vsock new connection ok after 27.8797s
spk-a new connection ok after 27.8913s
spk-a-local new connection ok after 34.2613s
== spk-a
exit=255 at 1795572933
== spk-a-local
exit=255 at 1795572933
== spk-a-vsock
exit=255 at 1795572933
```

### restart-incusd.sh（手を出さずに最後まで）

```
restart issued at 1795573512.953867128
t+0.0124068s incus.service=active
t+1.02746s incus.service=deactivating
t+9.15852s api during stop: spk-a
  new exec ssh during stop: failed
t+19.4374s api during stop: spk-a
  new exec ssh during stop: failed
t+29.7016s api during stop: spk-a
  new exec ssh during stop: failed
t+39.9798s api during stop: spk-a
  new exec ssh during stop: failed
t+50.2488s api during stop: spk-a
  new exec ssh during stop: failed
t+60.5212s api during stop: spk-a
  new exec ssh during stop: failed
t+70.7923s api during stop: spk-a
  new exec ssh during stop: failed
t+81.0743s api during stop: spk-a
  new exec ssh during stop: failed
t+91.3687s api during stop: spk-a
  new exec ssh during stop: failed
t+101.639s api during stop: spk-a
  new exec ssh during stop: failed
t+111.923s api during stop: spk-a
  new exec ssh during stop: failed
t+122.191s api during stop: spk-a
  new exec ssh during stop: failed
t+132.458s api during stop: spk-a
  new exec ssh during stop: failed
t+142.757s api during stop: spk-a
  new exec ssh during stop: failed
t+153.037s api during stop: spk-a
  new exec ssh during stop: failed
t+163.315s api during stop: spk-a
  new exec ssh during stop: failed
t+173.604s api during stop: spk-a
  new exec ssh during stop: failed
t+183.881s api during stop: spk-a
  new exec ssh during stop: failed
t+194.189s api during stop: spk-a
  new exec ssh during stop: failed
t+204.527s api during stop: spk-a
  new exec ssh during stop: failed
t+214.804s api during stop: spk-a
  new exec ssh during stop: failed
t+225.068s api during stop: spk-a
  new exec ssh during stop: failed
t+235.347s api during stop: spk-a
  new exec ssh during stop: failed
t+245.615s api during stop: spk-a
  new exec ssh during stop: failed
t+255.892s api during stop: spk-a
  new exec ssh during stop: failed
t+266.173s api during stop: spk-a
  new exec ssh during stop: failed
t+276.455s api during stop: spk-a
  new exec ssh during stop: failed
t+286.715s api during stop: spk-a
  new exec ssh during stop: failed
t+296.992s api during stop: spk-a
  new exec ssh during stop: failed
t+300.158s incus.service=activating
systemctl restart returned after 303.881s
t+304.206s incus.service=active
spk-a-vsock new connection ok at t+304.541s
spk-a-local new connection ok at t+304.571s
spk-a new connection ok at t+304.585s
== spk-a live session
exit=255 at 1795573813.091559606
== spk-a-local live session
exit=255 at 1795573816.338202767
== spk-a-vsock live session
1795573835
dsh-bot-511ab6a0,RUNNING,0
dsh-onb-0c9cbcdd,RUNNING,0
dsh-onb-5dd5c5cf,RUNNING,0
dsh-onb-9d3ec040,RUNNING,0
spk-a,RUNNING,0
```

1 回目（11:10）は途中で exec の ProxyCommand を手で kill したため、停止が exec の operation を待つことだけ分かった（kill の約 6 秒後に active）。

### volume

- cloud-init の fs_setup（partition: none, overwrite: false）が作り直した VM で mkfs.ext4 -F を走らせ、中身が消えた。fstab の x-systemd.makefs に変えて 2 回作り直し、残ることを確認。
- 動いている VM の block ボリュームの拡張は "In use"。止めて 3 GiB → 4 GiB、x-systemd.growfs で df 2.9G → 3.9G。
- 512 MiB fdatasync: workspace 初回 94.8–101 MB/s、2 回目 490 MB/s、root 232–484 MB/s。2000 個の小さいファイル: workspace 154 ms、root 129 ms。

### matrix2.mjs（一部、limits.disk.pool の上限に当たった項目は matrix3 で取り直し）

```
network: {"config":{},"description":"","name":"dshspk0","type":"bridge","used_by":["/1.0/profiles/dsh-bot?project=dsh-spike"],"managed":true,"status":"Created","locations":["none"],"project":"default"}
OK     create VM security.csm=false
OK     create VM security.nesting=true
DENIED create VM security.secureboot=false + guestapi=false + user.* + cloud-init + limits  — POST /1.0/instances -> 500: Failed checking if instance creation allowed: Reached maximum aggregate value "30GiB" for "limits.disk.pool.dshspike" in project "dsh-spike"
DENIED create VM nic on dshbr0  — POST /1.0/instances -> 500: Failed checking if instance creation allowed: Reached maximum aggregate value "30GiB" for "limits.disk.pool.dshspike" in project "dsh-spike"
DENIED create VM nic without nic (none)  — POST /1.0/instances -> 500: Failed checking if instance creation allowed: Reached maximum aggregate value "30GiB" for "limits.disk.pool.dshspike" in project "dsh-spike"
OK     POST custom volume block 1GiB
OK     PATCH custom volume size 2GiB
OK     PATCH volume user.dsh-bot.id
DENIED POST volume snapshot  — POST /1.0/storage-pools/dshspike/volumes/custom/ws-probe/snapshots -> 500: Project "dsh-spike" doesn't allow for snapshot creation
OK     DELETE custom volume
OK     POST custom volume filesystem 1GiB
DENIED create VM with filesystem volume at path  — POST /1.0/instances -> 500: Failed checking if instance creation allowed: Reached maximum aggregate value "30GiB" for "limits.disk.pool.dshspike" in project "dsh-spike"
DENIED POST instance backup  — POST /1.0/instances/spk-ok/backups -> 500: Project "dsh-spike" doesn't allow for backup creation
DENIED POST instance snapshot  — POST /1.0/instances/spk-ok/snapshots -> 500: Project "dsh-spike" doesn't allow for snapshot creation
DENIED PUT instance raw.idmap later  — PATCH /1.0/instances/spk-ok -> 404: Failed to fetch instance "spk-ok" in project "dsh-spike": Instance not found
DENIED PATCH instance limits.memory 3GiB, root 14GiB  — GET /1.0/instances/spk-ok -> 404: Failed to fetch instance "spk-ok" in project "dsh-spike": Instance not found
done
```
