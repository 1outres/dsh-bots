# Per-bot KVM VMs (Incus)

Each dsh bot runs its tools (bash, file I/O, ripgrep) inside its own small
QEMU/KVM virtual machine managed by [Incus](https://linuxcontainers.org/incus/).
DSH reaches the VM with `@deepseek-ai/dsh-ssh` over SSH **on AF_VSOCK** — there
is no network path from the host into a VM. VMs, not containers: the bot gets
its own kernel.

Users install all of this with the repository's `install.sh` ([README](../../README.md));
the spec is `docs/specs/installer.md`.

| file                       | what                                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `host-setup.sh`            | root, idempotent host setup in phases: `packages`, `incus` (pool, bridge, ACL, profile, group), `firewall`, `workspaces`, `all`      |
| `lib.sh`                   | OS detection, failure report, alias helpers; sources `../release.env`                                                                |
| `import-image.sh`          | root: import a verified image file and move the `dsh-bot-base` alias to it                                                           |
| `check-vm.sh`              | root: a throw-away VM: sshd over vsock, HTTPS out, the shared workspace's id mapping                                                 |
| `build-base-image.sh`      | author: builds the base VM image and (re)points the `dsh-bot-base` alias at it                                                       |
| `provision-base.sh`        | runs inside the builder VM (called by `build-base-image.sh`)                                                                         |
| `export-image.sh`          | author: splits the image for a GitHub Release, writes `manifest.txt`, sets `IMAGE_TAG` / `IMAGE_MANIFEST_SHA256` in `../release.env` |
| `publish-image.sh`         | author: uploads that export as the GitHub release `IMAGE_TAG` (gh CLI, never "latest") and checks it                                 |
| `check-image-release.sh`   | author and the Release workflow: the release `IMAGE_TAG` is published with the manifest `IMAGE_MANIFEST_SHA256` and every part       |
| `../nixos/dsh-bots.nix.in` | the NixOS module the installer writes instead of the `packages`, `firewall` and `workspaces` phases                                  |

### Supported hosts

| OS                           | Incus                                       | notes                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Debian 13                    | Debian's 6.0.4                              |                                                                                                                                                                                                                                                                                                                                                                                            |
| Debian 12, Ubuntu 24.04      | Zabbly `lts-6.0` (third party, asked first) | Debian 12 has no `virtiofsd`; Ubuntu's 6.0.0 refuses `io.bus=virtiofs` (both measured)                                                                                                                                                                                                                                                                                                     |
| Fedora 42+                   | Fedora's                                    |                                                                                                                                                                                                                                                                                                                                                                                            |
| Arch Linux                   | Arch's                                      |                                                                                                                                                                                                                                                                                                                                                                                            |
| NixOS                        | `virtualisation.incus`                      | the installer writes `dsh-bots.nix`; rebuild, then run it again                                                                                                                                                                                                                                                                                                                            |
| RHEL / Rocky / Alma 9 and 10 | —                                           | not supported: EPEL 9 and 10 have no Incus; the COPR builds the Incus docs name (`neelc/incus` 7.0.0 for EL 9 and 10; also `neil/incus` 6.8) do not find EL's QEMU (`/usr/libexec/qemu-kvm`) and run no VMs (measured); upstream's only way is a symlink to `qemu-system-x86_64`, and EL's QEMU lacks the SPICE Incus VMs use ([lxc/incus#1301](https://github.com/lxc/incus/issues/1301)) |

Any of them in WSL2 too (systemd, nested virtualization, modules: see the spec). Incus 6.0.4 or newer.

## What gets set up

| object        | name / value                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage pool  | `dsh` — btrfs on a sparse loop file (`/var/lib/incus/disks/dsh.img`, 80 GiB max; `POOL`, `POOL_SIZE`); CoW clones make instance creation cheap                                                                                                                                                                                                                                                                                  |
| network       | `dshbr0` bridge, `10.240.80.1/24`, DHCP, NAT (masquerade) to the internet, IPv6 disabled (no address on the bridge, and the ACL rejects IPv6), DNS domain `dsh-bots.internal`                                                                                                                                                                                                                                                   |
| network ACL   | `dsh-bot-egress` on `dshbr0`: egress reject `0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/3`, all IPv6; allow other IPv4; no ingress rules; default ingress/egress action `reject`                                                                                                                                                                                                |
| profile       | `dsh-bot`: 2 vCPU, 2 GiB RAM, 10 GiB root on `dsh` (dsh-bot-vm gives each bot VM its own CPUs, memory and root size in the instance's config, default 4 / 6 GiB / 20 GiB; from the profile it takes only the root's pool), `boot.autostart=true`, `security.guestapi=false` (no `/dev/incus` in the guest), secure boot off, NIC `eth0` on `dshbr0` with `security.port_isolation` (no VM↔VM traffic), MAC + IPv4 anti-spoofing |
| image alias   | `dsh-bot-base` — Debian 13 (`images:debian/13/cloud`) + Node 24 (NodeSource), `/opt/dsh-ssh-helper`, ripgrep (`/usr/bin/rg`), git, curl, python3, build-essential, …, the desktop connector's packages (below); no DSH of its own                                                                                                                                                                                               |
| VM user       | `bot` (uid/gid 1001, set explicitly; dsh-bot-vm's `guestUid`/`guestGid`; the cloud image's `debian` user is removed), no password, **passwordless sudo** via `/etc/sudoers.d/90-dsh-bot`, home `/home/bot`, workspace `/home/bot/workspace` (the cwd of the bot's sessions; shared from the host, see below)                                                                                                                    |
| vsock proxy   | none on the host: dsh-bot-vm's own `lib/vsock-proxy.js` with `socat` (below)                                                                                                                                                                                                                                                                                                                                                    |
| bots root     | `~/.dsh/bots` (`BOTS_ROOT`) bind-mounted onto itself `nosuid,nodev,nosymfollow` by `home-<user>-.dsh-bots.mount` (enabled, `WantedBy=local-fs.target`); `incus.service.d/50-dsh-bots-root.conf` adds `RequiresMountsFor=` so autostarted VMs never share from it unmounted                                                                                                                                                      |
| socket access | the DSH user joins `incus-admin` (DSH must be restarted to get the group)                                                                                                                                                                                                                                                                                                                                                       |
| firewall      | ufw / firewalld / Docker: `dshbr0` allowed (below); another forward filter that drops: the installer stops                                                                                                                                                                                                                                                                                                                      |

Inside the VM the NIC shows up as `enp5s0` (the profile device name `eth0`
is only the Incus device name).

The `default` profile is left empty (no NIC, no disk) so nothing lands on a
network by accident; bot VMs are launched with `-p dsh-bot` only.

### Network isolation

Incus implements the bridge ACL in its own nft table `inet incus`
(chains `aclin/aclout/aclfwd.dshbr0`). Baseline services (DHCP 67, DNS 53
on the gateway, some ICMP errors) are accepted _before_ the ACL; everything
else from a VM to the host (any host address: the gateway and every other
interface, DSH Web included) or to private/CGNAT/link-local ranges is
rejected. Public addresses are reachable like any internet host, also when
they lead back to this host (e.g. a public reverse proxy in front of DSH Web);
DSH Web's own authentication covers that path. Replies to VM-initiated connections are allowed (`ct state
established,related`). The host cannot open network connections into VMs
either (no ingress rules); SSH goes over vsock.

Bridge ACLs do not see traffic between two VMs on the same bridge (it never
leaves the bridge), so the NIC uses `security.port_isolation=true` (kernel
bridge port isolation): VMs only talk to the gateway.

Incus enables `net.ipv4.ip_forward=1` for the NAT bridge. Forwarding
between the host's other interfaces is left to the host's own firewall and
networks' policies.

Another firewall's forward filter in a different nft table drops VM traffic
even when Incus' table accepts it. `host-setup.sh firewall`: with ufw active,
`ufw allow in on dshbr0` and `ufw route allow in|out on dshbr0`; with
firewalld running, `dshbr0` in the `trusted` zone; with Docker's
`DOCKER-USER` chain, `dsh-bots-docker-forward.service` (after and part of
`docker.service`) inserts accept rules for `dshbr0` there. Any other base
chain with `hook forward` and `policy drop` outside `inet incus`: it stops and
names the chain. None of these changes what the ACL rejects (VM→host).
iptables-legacy rules are not visible to nft; `check-vm.sh` finds them as a
VM without internet.

Never enable Debian's `nftables.service`: its `/etc/nftables.conf` starts
with `flush ruleset` and would wipe Incus' tables (and any other service's).

### SSH over vsock

The image runs sshd **only** via `sshd-vsock.socket` (`ListenStream=vsock::22`,
`Accept=yes`, per-connection `sshd -i`); `ssh.service`/`ssh.socket` are masked.
Config: key-only, `AllowUsers bot`, `PermitRootLogin no`,
`AllowStreamLocalForwarding yes` (dsh-ssh helper channel).

On the host, `/dev/vsock` is world-accessible, so any uid can connect; the VM's
vsock CID is `volatile.vsock_id` (Incus may reassign it at start if it
collides, so it is looked up per connection). dsh-bot-vm writes, per bot:

```
ProxyCommand <DSH's node> <dsh-bot-vm>/lib/vsock-proxy.js --socket /var/lib/incus/unix.socket --project default --instance <vm> --port 22 --socat /usr/bin/socat
ProxyUseFdpass no
```

`vsock-proxy.js` reads the CID from the Incus API and runs
`socat STDIO VSOCK-CONNECT:<cid>:22` (socat 1.7.4 or newer; every supported
host has it). One mechanism everywhere: earlier versions used
`/usr/local/bin/dsh-bot-vsock-proxy` and `systemd-ssh-proxy` (systemd 256+,
missing on Debian 12, Ubuntu 24.04). The config is rewritten on every ensure,
so existing bots move over when the new dsh-bot-vm ensures them; the old
helper can then be deleted (`grep -l dsh-bot-vsock-proxy ~/.dsh/bots-vm/ssh/*.conf`
finds none).

Caveat (measured): right after `systemctl restart incus.socket` (incusd
restart with socket re-creation) vsock connections to running VMs failed for
~20 s ("Connection timed out", then "reset by peer") and then recovered
without guest action; a plain `restart incus.service` did not show this.
Callers should retry connection failures for a while.

### Incus access for the running DSH process

`incus` talks to `/var/lib/incus/unix.socket` (root:incus-admin 0660).
`host-setup.sh incus` adds the DSH user to `incus-admin`; a running DSH keeps
the groups it started with, so the installer says to restart DSH (and to log
in again first when DSH is started from a shell). Earlier versions also put a
POSIX ACL on the socket (`incus.socket.d/50-dsh-user-acl.conf`) so that an
already running `dsh.service` needed no restart; that is no longer created,
and an existing one is left alone (delete it by hand once DSH runs with the
group: `grep Groups /proc/<pid>/status` lists the group's id).

Note: access to the Incus admin socket is root-equivalent on the host. The
restricted `incus-user` socket (per-user project) cannot use the shared
`dshbr0`/ACL/profile without extra project configuration.

### Shared workspaces (virtiofs)

A bot's `/home/bot/workspace` is the host directory `~/.dsh/bots/<bot>/workspace`
(`@1outres/dsh-bot-vm`, config `hostRoot`), attached as an Incus disk device
(`source=<dir> path=/home/bot/workspace io.bus=virtiofs`). Incus starts one
`virtiofsd` per share (root, sandboxed: own mount namespace whose `/` is the
shared directory, seccomp, reduced capabilities) after bind-mounting the source
to `/var/lib/incus/devices/<vm>/…` (the bind keeps the source mount's flags);
`incus-agent` mounts it in the guest at boot (also with
`security.guestapi=false`).

Ids: the VM's `raw.idmap` is `uid <host uid> 1001` / `gid <host gid> 1001` (Incus 6.0.4+, any virtiofsd with `--translate-uid`; measured with Debian's 6.0.4 and Zabbly's 6.0.7);
Incus turns it into `virtiofsd --translate-uid=map:1001:<host uid>:1
--translate-uid=forbid-guest:…` for every other id. So `bot`'s files are the
host user's (the DSH user), the host user's files are `bot`'s in the VM, and
**guest root cannot create or chown anything in the share** (`EIO`); it can
still write existing files. Mapping two guest ids onto one host id is refused
by virtiofsd, which then leaves `incus start` hanging (QEMU waits for the
vhost-user socket; kill that VM's QEMU to recover). `raw.idmap` cannot be
changed while the VM runs, and `incus config device remove` of a mounted
share fails after 10 s and leaves the guest's mount hanging: stop the VM
first.

Why the mount options (all measured on this host, guest root writing into the
share):

| guest action (as root unless noted)                 | result                                                                                                                                          |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ln -s /etc/passwd x`; `ln -s ../../.. up` (as bot) | works; resolves to the **guest's** files in the VM; on the host `cat x` fails with `ELOOP` (`nosymfollow`)                                      |
| `..` from the workspace                             | the guest's `/home/bot` (guest kernel); virtiofsd's `..` of its root is its root                                                                |
| `ln /etc/passwd x`                                  | `EXDEV` (other file system)                                                                                                                     |
| `mknod`, `mkfifo`, `cp`, `touch`, `chown 0:0`       | `EIO` (id map); without the map: created root-owned, and on the host the device node is unusable even for root (`nodev`, `EACCES`)              |
| setuid binary (bot: `chmod 4755` its copy of `id`)  | host: setuid ignored (`nosuid`). Without the map a root-owned setuid `id` ran as `euid=0` for the DSH user once the self bind mount was removed |

`nosymfollow` does not affect the guest (its kernel resolves symlinks; virtiofsd
never follows them). On the host it means symlinks under `~/.dsh/bots` do not
resolve at all (also harmless ones, e.g. `node_modules/.bin`).

Not limited: disk space. A bot can fill the file system `~/.dsh/bots` lies on
(here `/`). A size-limited dedicated file system (a loop-mounted ext4 image,
like the storage pool) would cap that for all bots together, at the cost of a
fixed size to manage and another image file to back up; not done.

Deleting a bot deletes its VM but keeps `~/.dsh/bots/<bot>` on the host.

## Usage

```sh
curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash   # users
sudo DSH_USER=$USER ./host-setup.sh all     # the host part alone, from a checkout
./build-base-image.sh                       # author: ~25 min; rebuild whenever packages / DSH version change
./export-image.sh image-YYYYMMDD            # author: parts + manifest for a release (infra/RELEASING.md)
./publish-image.sh                          # author: upload it as the release IMAGE_TAG
```

### Desktop packages, Google Chrome and Playwright MCP

The image also has the packages of `@1outres/dsh-bot-connector-desktop`
(XFCE, Xvnc, LibreOffice, Google Chrome, AT-SPI, fonts, fcitx5; the published image
grew from 858 MiB to 1607 MiB, the VM's root file system uses ~4.2 GiB of 10).
Measured: turning the desktop on for a new bot went from ~10 min (apt
downloading ~400 packages) to ~80 s, of which ~45 s is the VM restart for
memory and ~35 s the preparation itself. Their one list is
`packages/dsh-bot-connector-desktop/debian-packages.txt` (one Debian package
name per line): `build-base-image.sh` passes it to `provision-base.sh`
(`DESKTOP_PACKAGES`), which installs it with `--no-install-recommends`, and
the connector embeds the same file at build time. The connector's preparation
is unchanged — it checks the list with `dpkg-query` and runs `apt-get install`
only for a VM that lacks some — so a VM from a current image skips the
download. Rebuild the image when the list changes; VMs already created keep
their packages (the preparation installs what they lack).

`google-chrome-stable` comes from Google's apt source: `build-base-image.sh`
pushes the desktop connector's `vm/apt/google-chrome.asc` and
`vm/apt/google-chrome.sources` into the builder (the same targets as the
connector's preparation) before provisioning. It also pushes the browser
connector's `vm/mcp/package.json`, `npm-shrinkwrap.json` and `vm/install-mcp.sh`,
and `provision-base.sh` runs that script (`npm ci`) into
`/opt/dsh-browser/mcp`, as the browser connector's preparation does when the
installed shrinkwrap differs.

### Rebuilding

The alias is moved with one update of its target (`PATCH
/1.0/images/aliases/<alias>`), so a VM created during the rebuild gets the old
or the new image, never no image. The previous image is then deleted, unless
another alias names it: to keep it, alias it before rebuilding and delete it
when no longer needed:

```sh
incus image alias create dsh-bot-base-prev-$(date +%Y%m%d) dsh-bot-base
./build-base-image.sh
incus image delete dsh-bot-base-prev-<date>     # later
```

Existing VMs are not affected by a rebuild (each has its own copy).

The dsh-ssh helper is `DSH_VERSION` of `infra/release.env`; `HELPER_SHA256`
is its expected sha256 (the build fails on mismatch).

DSH's grep and glob spawn the host DSH's own ripgrep path (wherever DSH is
installed: `/usr/lib/node_modules/…`, `~/.npm-global/…`, `/nix/store/…`) in
the bot's environment. The image has no DSH; dsh-bot-vm resolves that path
with `@deepseek-ai/dsh-util-ripgrep` and makes it, inside each VM, a symlink to
`/usr/bin/rg` (Debian's ripgrep 14.1.1; DSH ships 15.0.0, and the flags DSH
passes — `--no-config --json --regexp --glob --files --sort=modified --hidden --no-ignore` —
gave the same matches and file lists on both, measured).

### Creating a bot VM (what dsh-bot-vm does)

State lives in `~/.dsh/bots-vm/bots/<bot>/` (keys, `known_hosts`,
`state.json`), `~/.dsh/bots-vm/ssh/<bot>.conf` and `~/.dsh/bots-vm/owner`
(the id its instances are tagged with); `~/.ssh/config` starts with
`Include ~/.dsh/bots-vm/ssh/*.conf` (added by `host-setup.sh workspaces`,
previous file backed up as `config.bak.<timestamp>`). The steps, for
reading and by hand (`packages/dsh-bot-vm/README.md` is the reference):

1. Client key: `ssh-keygen -t ed25519 -N '' -f ~/.dsh/bots-vm/<name>/id_ed25519`.
2. Host key generated on the host: `ssh-keygen -t ed25519 -N '' -f ~/.dsh/bots-vm/<name>/ssh_host_ed25519_key`;
   `known_hosts` gets `dsh-bot-<name> ssh-ed25519 AAAA…` (keyed by `HostKeyAlias`).
3. cloud-init user-data:

   ```yaml
   #cloud-config
   ssh_keys:
     ed25519_private: |
       -----BEGIN OPENSSH PRIVATE KEY-----
       …
     ed25519_public: ssh-ed25519 AAAA…
   ssh_genkeytypes: [ed25519]   # must be non-empty (schema)
   users:
     - name: bot
       lock_passwd: true
       shell: /bin/bash
       ssh_authorized_keys:
         - ssh-ed25519 AAAA… dsh@dsh-bot-<name>
   runcmd:
     - [sync]   # flush injected keys; see "early restart" below
   ```

4. The shared workspace: `install -d -m 0700 ~/.dsh/bots/<name>`, `install -d -m 0755 ~/.dsh/bots/<name>/workspace`, then

   ```sh
   incus init dsh-bot-base <name> --vm -p dsh-bot -c cloud-init.user-data="$(cat user-data.yaml)" \
     -c raw.idmap="$(printf 'uid %s 1001\ngid %s 1001' "$(id -u)" "$(id -g)")"
   incus config device add <name> workspace disk source=$HOME/.dsh/bots/<name>/workspace \
     path=/home/bot/workspace io.bus=virtiofs
   incus start <name>
   ```

5. ssh alias (`<proxy>` as under "SSH over vsock"):

   ```
   Host dsh-bot-<name>
     ProxyCommand <proxy>
     ProxyUseFdpass no
     User bot
     IdentityFile ~/.dsh/bots-vm/bots/<name>/id_ed25519
     IdentitiesOnly yes
     HostKeyAlias dsh-bot-<name>
     UserKnownHostsFile ~/.dsh/bots-vm/bots/<name>/known_hosts
     StrictHostKeyChecking yes
   ```

6. Once ready: the host DSH's ripgrep path linked to `/usr/bin/rg` in the VM.

Ordering: on the first boot cloud-init (`cloud-init-network.service`, which
is ordered before `sysinit.target`) runs `users`/`ssh`, i.e. before
`sockets.target` and thus before `sshd-vsock.socket` listens.

Early restart: cloud-init's writes (injected host key, `authorized_keys`) can
still be in the page cache when sshd already answers; a forced restart at that
moment left 0-byte host key files. The user-data therefore ends with
`runcmd: [sync]`, and callers must wait for
`/var/lib/cloud/instance/boot-finished` (readable by `bot`, e.g.
`ssh <alias> test -e /var/lib/cloud/instance/boot-finished`) before treating a
new VM as ready or restarting it — `@1outres/dsh-bot-vm` does this (and also
checks that `bot` can write `/home/bot/workspace`).
Image-side prerequisites: the socket unit is named exactly `sshd-vsock.socket`
and `/home/bot/workspace` exists, owned by `bot`. Rotating the client key later: `incus file push key.pub
<name>/home/bot/.ssh/authorized_keys --uid 1001 --gid 1001 --mode 0600`.

The private host key is stored in the instance config (`cloud-init.user-data`,
visible to Incus admins). Inside the VM: `/dev/incus/sock` is disabled
(`security.guestapi=false`; it is root-only anyway), and incus-agent writes the
user-data to `/var/lib/cloud/seed/nocloud-net/` world-readable, so the image's
`dsh-cloud-seed-perms.service` makes that tree root-only on every boot before
cloud-init and sshd start. cloud-init's own copies/logs are root/adm only.

### Root inside the VM

`bot` has passwordless sudo (`bot ALL=(ALL) NOPASSWD:ALL`, mode 0440, checked
with `visudo -c` at build time), so the bot can install packages etc. The VM
boundary is what isolates it; none of the host-side controls depend on the
guest's root being unreachable:

- network ACL `dsh-bot-egress` and the `inet incus` rules are enforced on the
  host (root in the guest cannot change them);
- `security.port_isolation` (no VM↔VM traffic) is a host bridge-port flag;
- `security.mac_filtering` / `security.ipv4_filtering` drop spoofed MAC/IPv4
  sources on the host, so changing the guest's address does not help;
- `security.guestapi=false`: no `/dev/incus` API to query instance config.
- the shared workspace: virtiofsd's id map refuses guest root's file creation
  there, and the host mount is `nosuid,nodev,nosymfollow` (see "Shared
  workspaces").

What root in the VM _can_ read: the cloud-init seed and cloud-init's copies
of the user-data, i.e. that VM's own SSH host private key (and its own
`authorized_keys`). That only allows impersonating this same VM to the host,
which the bot could do anyway as root of it. Nothing about other VMs or the
host is stored in the guest.

Timing (measured on this host, nested KVM): the first instance created from a
freshly published image takes ~3–5 min extra (Incus unpacks the image into
the pool once); afterwards create→SSH-ready is ~40 s, restart→SSH ~25 s; an
idle VM uses ~300 MiB guest memory, ~550 MiB qemu RSS on the host.

## Verify

```sh
incus network acl show dsh-bot-egress; sudo nft list table inet incus
incus exec <vm> -- su - bot -c 'curl -sI https://example.com | head -1'     # works
incus exec <vm> -- su - bot -c 'curl -m5 http://<host LAN address>:<port>/'  # fails
# also 10.240.80.1:<any>, 192.168.0.0/16, 10/8, 172.16/12, 100.64/10, 169.254.169.254
ssh dsh-bot-<name> id                                                        # over vsock
```

## Tear down

```sh
incus delete --force <bot VMs…>
incus image delete dsh-bot-base
incus profile delete dsh-bot
incus network delete dshbr0
incus network acl delete dsh-bot-egress
incus storage delete dsh
sudo systemctl disable --now "$(systemd-escape -p --suffix=mount ~/.dsh/bots)" dsh-bots-docker-forward.service
sudo rm -f "/etc/systemd/system/$(systemd-escape -p --suffix=mount ~/.dsh/bots)" \
  /etc/systemd/system/incus.service.d/50-dsh-bots-root.conf /etc/systemd/system/dsh-bots-docker-forward.service \
  /etc/modules-load.d/dsh-bots.conf
sudo systemctl daemon-reload
# ufw: ufw delete allow in on dshbr0; ufw route delete allow in on dshbr0; ufw route delete allow out on dshbr0
# firewalld: firewall-cmd --permanent --zone=trusted --remove-interface=dshbr0 && firewall-cmd --reload
# remove the "Include ~/.dsh/bots-vm/ssh/*.conf" line from ~/.ssh/config; rm -rf ~/.dsh/bots-vm
# ~/.dsh/bots holds the bots' workspaces: back it up / remove it yourself
# dsh plugin --profile <profile> remove @1outres/dsh-bots
# NixOS: drop dsh-bots.nix from imports and rebuild
```
