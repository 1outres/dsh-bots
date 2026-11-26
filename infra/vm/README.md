# The VM host (Incus)

Each dsh bot runs its tools (bash, file I/O, ripgrep) inside its own small
QEMU/KVM virtual machine managed by [Incus](https://linuxcontainers.org/incus/),
on a **VM host**: this machine (DSH talks to Incus' Unix socket) or another one
(DSH talks to its HTTPS API with a client certificate restricted to one project).
DSH reaches a VM with SSH carried through Incus' exec API (`sshd -i` in the VM,
docs/specs/incus-endpoint.md §5.2): there is no network path from the host into
a VM, and nothing in the VM listens. VMs, not containers: the bot gets its own kernel.

Users prepare a VM host with the repository's `install.sh` ([README](../../README.md));
the spec is `docs/specs/installer.md`. An Incus server that runs other things gets a
project from its administrator instead (`../incus/create-project.sh`).

| file                     | what                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host-setup.sh`          | root, idempotent VM host setup in phases: `packages`, `incus` (pool, bridge, ACL, project), `firewall`, `all`, `https`, `token`; `preflight` without root; `--events` for JSON lines (docs/specs/vm-host-modes.md §5.5) |
| `lib.sh`                 | OS detection, failure report, alias helpers; sources `../release.env`                                                                                                                                                   |
| `../incus/objects.sh`    | the ACL, bridge, project and trust token, shared with `../incus/create-project.sh`                                                                                                                                      |
| `check-vm.sh`            | a throw-away VM in the project from its base image: Incus' exec, HTTPS out, the gateway refused                                                                                                                         |
| `build-base-image.sh`    | author: builds the base VM image in the project and (re)points its `dsh-bot-base` alias at it                                                                                                                           |
| `provision-base.sh`      | runs inside the builder VM (called by `build-base-image.sh`)                                                                                                                                                            |
| `export-image.sh`        | author: splits the image for a GitHub Release, writes `manifest.txt`, sets `IMAGE_TAG` / `IMAGE_MANIFEST_SHA256` in `../release.env` and the plugin                                                                     |
| `publish-image.sh`       | author: uploads that export as the GitHub release `IMAGE_TAG` (gh CLI, never "latest") and checks it                                                                                                                    |
| `check-image-release.sh` | author and the Release workflow: the release `IMAGE_TAG` is published with the manifest `IMAGE_MANIFEST_SHA256` and every part                                                                                          |

The base image is imported by the plugin, from the DSH host (dsh-bots settings → VM host →
Base image; `packages/dsh-bot-vm/README.md`).

### VM hosts

| OS                           | Incus                                       | notes                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Debian 13                    | Debian's 6.0.4                              |                                                                                                                                                                                                                                                                                                                 |
| Debian 12, Ubuntu 24.04      | Zabbly `lts-6.0` (third party, asked first) | Debian 12 has no Incus; Ubuntu's is 6.0.0                                                                                                                                                                                                                                                                       |
| Fedora 42+                   | Fedora's                                    |                                                                                                                                                                                                                                                                                                                 |
| Arch Linux, NixOS, WSL2      | —                                           | not VM hosts (not tested; WSL stops when idle). They can be the DSH host: the plugin needs nothing there but OpenSSH's client                                                                                                                                                                                   |
| RHEL / Rocky / Alma 9 and 10 | —                                           | not VM hosts: EPEL 9 and 10 have no Incus; the COPR builds the Incus docs name (`neelc/incus` 7.0.0; also `neil/incus` 6.8) do not find EL's QEMU (`/usr/libexec/qemu-kvm`) and run no VMs (measured), and EL's QEMU lacks the SPICE Incus VMs use ([lxc/incus#1301](https://github.com/lxc/incus/issues/1301)) |

x86_64 with KVM, systemd, Incus 6.0.4 or newer.

## What gets set up

| object        | name / value                                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| storage pool  | `dsh` — btrfs on a sparse loop file (`/var/lib/incus/disks/dsh.img`, 80 GiB max; `POOL`, `POOL_SIZE`); CoW clones make instance creation cheap                                                                                                                                           |
| network       | `dshbr0` bridge, `10.240.80.1/24`, DHCP, NAT (masquerade) to the internet, IPv6 disabled (no address on the bridge, and the ACL rejects IPv6), DNS domain `dsh-bots.internal`                                                                                                            |
| network ACL   | `dsh-bot-egress` on `dshbr0`: egress reject `0/8, 10/8, 100.64/10, 127/8, 169.254/16, 172.16/12, 192.0.0/24, 192.168/16, 198.18/15, 224/3`, the gateway, all IPv6; allow other IPv4; no ingress rules; default ingress/egress action `reject`                                            |
| project       | `dsh-bots` (`PROJECT`): own images, profiles and volumes, the default project's networks; `restricted=true` with only `dshbr0`; every other pool `limits.disk.pool.<pool>=0`; `user.dsh-bots.pool` / `network` / `egress-acl` say which ones the plugin uses; limits only with `LIMIT_*` |
| kernel module | `vhost_vsock` (`/etc/modules-load.d/dsh-bots.conf`): Incus' exec reaches a VM's incus-agent over vsock                                                                                                                                                                                   |
| https         | `core.https_address` when unset: `127.0.0.1:<port>` (`HTTPS_SCOPE=loopback`) or `:<port>` and the port in ufw / firewalld (`all`, the default); `HTTPS_PORT` (8443)                                                                                                                      |
| token         | a trust token for one client certificate restricted to the project (`CLIENT_NAME`, `dsh-bots`); `REPLACE_CLIENT` removes a previous certificate first                                                                                                                                    |
| firewall      | ufw / firewalld / Docker: `dshbr0` allowed (below); another forward filter that drops: the installer stops                                                                                                                                                                               |

No profile: the plugin writes every VM's config and devices into the instance itself
(docs/specs/incus-endpoint.md §3.4), and the bots' files are on a block volume per bot in the
project (§5.4). Nothing of a bot is on the VM host's file system outside Incus.

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
either (no ingress rules); SSH goes through Incus' exec.

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

### Incus access

- **This machine** (local): `/var/lib/incus/unix.socket` (root:incus-admin 0660). install.sh
  adds the DSH user to `incus-admin`; a running DSH keeps the groups it started with, so the
  installer says to restart DSH. Access to that socket is root-equivalent on the host; the plugin
  confines itself to the project in its code (§6.1).
- **Another machine** (remote): DSH pairs with the token and keeps a client certificate that Incus
  restricts to the project (`restricted: true`, `projects: [dsh-bots]`). It cannot see or change
  anything outside the project, nor the network, the ACL or the project's own config. To end it:
  `incus config trust list` and `incus config trust remove <fingerprint>` on the VM host.
- While DSH has an SSH connection open to a bot, an incusd stop or restart waits for it up to
  `core.shutdown_timeout` (5 minutes by default; §8.2); the plugin closes connections idle for 5 minutes.

## Usage

```sh
curl -fsSL https://raw.githubusercontent.com/1outres/dsh-bots/main/install.sh | bash   # users
sudo ./host-setup.sh all https token        # the same from a checkout (another machine; install.sh grants incus-admin itself for this machine)
./check-vm.sh                               # after the plugin imported the base image
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

`build-base-image.sh` builds in the project (`PROJECT`, `dsh-bots`) on the pool and network it
declares, publishes the image there and moves the project's alias with one update of its target
(`PATCH /1.0/images/aliases/<alias>`), so a VM created during the rebuild gets the old or the new
image, never no image. The previous image is then deleted, unless another alias names it: to keep
it, alias it before rebuilding and delete it when no longer needed:

```sh
incus image alias create --project dsh-bots dsh-bot-base-prev-$(date +%Y%m%d) dsh-bot-base
./build-base-image.sh
incus image delete --project dsh-bots dsh-bot-base-prev-<date>     # later
```

Existing VMs are not affected by a rebuild (each has its own copy). With the plugin's
`manageImage` on (the default), it points the alias back at the release's image on the next
check: turn it off in a DSH that should use a local build.

The dsh-ssh helper is `DSH_VERSION` of `infra/release.env`; `HELPER_SHA256`
is its expected sha256 (the build fails on mismatch).

DSH's grep and glob spawn the host DSH's own ripgrep path (wherever DSH is
installed: `/usr/lib/node_modules/…`, `~/.npm-global/…`, `/nix/store/…`) in
the bot's environment. The image has no DSH; dsh-bot-vm resolves that path
with `@deepseek-ai/dsh-util-ripgrep` and makes it, inside each VM, a symlink to
`/usr/bin/rg` (Debian's ripgrep 14.1.1; DSH ships 15.0.0, and the flags DSH
passes — `--no-config --json --regexp --glob --files --sort=modified --hidden --no-ignore` —
gave the same matches and file lists on both, measured).

### What the plugin creates

`packages/dsh-bot-vm/README.md` ("What `ensure` does") is the reference: per bot an instance
`dsh-bot-<id>` and a block volume `dsh-bot-<id>-workspace` in the project, keys and an OpenSSH
config under `~/.dsh/bots-vm` on the DSH host, cloud-init user-data that installs the client key
for `bot` and the host key and mounts the workspace.

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
- `security.guestapi=false`: no `/dev/incus` API to query instance config;
- the workspace is a block device of the VM's own: the VM host never mounts it.

What root in the VM _can_ read: the cloud-init seed and cloud-init's copies
of the user-data, i.e. that VM's own SSH host private key (and its own
`authorized_keys`). That only allows impersonating this same VM to the host,
which the bot could do anyway as root of it. Nothing about other VMs or the
host is stored in the guest.

Timing (measured on this host, nested KVM): the first instance created from a
freshly imported image takes ~3–5 min extra (Incus unpacks the image into
the pool once); afterwards create→SSH-ready is ~40 s, restart→SSH ~25 s; an
idle VM uses ~300 MiB guest memory, ~550 MiB qemu RSS on the host.

## Verify

```sh
./check-vm.sh                                                     # exec, internet, gateway refused
incus network acl show dsh-bot-egress; sudo nft list table inet incus
incus exec --project dsh-bots <vm> -- su - bot -c 'curl -sI https://example.com | head -1'     # works
incus exec --project dsh-bots <vm> -- su - bot -c 'curl -m5 http://<host LAN address>:<port>/'  # fails
# also 10.240.80.1:<any>, 192.168.0.0/16, 10/8, 172.16/12, 100.64/10, 169.254.169.254
```

The dsh-bots settings measure the same from every bot's VM after each ensure (§6.4).

## Tear down

```sh
incus delete --project dsh-bots --force <bot VMs…>
incus storage volume delete dsh <workspace volumes…> --project dsh-bots
incus image delete --project dsh-bots dsh-bot-base
incus project delete dsh-bots
incus network delete dshbr0
incus network acl delete dsh-bot-egress
incus storage delete dsh
incus config trust list            # remote: remove the DSH's certificate, and unset core.https_address if nothing else uses it
sudo systemctl disable --now dsh-bots-docker-forward.service
sudo rm -f /etc/systemd/system/dsh-bots-docker-forward.service /etc/modules-load.d/dsh-bots.conf
sudo systemctl daemon-reload
# ufw: ufw delete allow in on dshbr0; ufw route delete allow in on dshbr0; ufw route delete allow out on dshbr0; ufw delete allow 8443/tcp
# firewalld: firewall-cmd --permanent --zone=trusted --remove-interface=dshbr0; firewall-cmd --permanent --remove-port=8443/tcp; firewall-cmd --reload
# on the DSH host: dsh plugin --profile <profile> remove @1outres/dsh-bots; rm -rf ~/.dsh/bots-vm
```

### From an earlier version

Versions before 0.4.0 ran bots in the `default` project with a profile `dsh-bot`, a shared
folder `~/.dsh/bots` (bind mount, `incus.service.d/50-dsh-bots-root.conf`) and an Include in
`~/.ssh/config`. 0.4.0 does not use or touch any of them: back up what the bots kept in
`~/.dsh/bots`, then remove the old VMs (`incus delete --force <vm>` in `default`), the
profile, the mount unit (`systemctl disable --now "$(systemd-escape -p --suffix=mount ~/.dsh/bots)"`
and its file), the drop-in, and the Include line, once they are no longer wanted.
