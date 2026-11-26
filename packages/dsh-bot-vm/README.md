# @1outres/dsh-bot-vm

Gives every bot its own Incus VM. Bot Agents run `bash`, read/write/edit, grep/glob, jobs, AGENTS.md and filesystem skills inside that VM over SSH; nothing of theirs runs on the Host.

The plugin (row `bot-vm`, `inject = ["bot"]`) registers the `incus-vm` environment with `@1outres/dsh-bot-core`. bot-core asks it to `ensure` every bot and puts the environment's rows into the bot's preset as an isolated group (`ssh`, `fs`, `subprocess`, `shell`, `sandboxPolicy`).

Every bot session's cwd is the environment's `workspace`, `/home/bot/workspace` inside the bot's VM (the same path in every VM). It is the bot's own **workspace volume**: a block custom volume of the Incus project, `<instancePrefix><id>-workspace` (docs/specs/incus-endpoint.md §5.4), attached to the VM as the disk device `workspace` (`/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_workspace` in the guest) and mounted there as ext4. Nothing of a bot is on the Host, and bot-core never uses a Host path for a bot.

### The workspace volume

- **File system.** cloud-init writes one fstab line (`ext4 defaults,x-systemd.makefs,x-systemd.growfs,x-systemd.device-timeout=60s`) and, once, mounts it through systemd and gives its top to `bot`. systemd makes the file system only on a device without one, so a VM created again finds the files (cloud-init's `fs_setup` is not used: it reformatted an existing volume). Owner and permissions are the guest's own: no id mapping, and guest root writes like any other user.
- **Size.** The bot's spec `diskGiB` is the volume's size. It only grows: a running VM's block volume cannot be resized, so `ensure` stops the VM, sets the size and starts it, and `x-systemd.growfs` grows the ext4 on that boot (measured: 20 → 22 GiB, `df` 20G → 22G). A smaller size is refused.
- **Lifetime.** The volume outlives the VM. `remove` deletes the VM, keys and ssh config at once and marks the volume `user.dsh-bot.orphaned`; the clean-up deletes it after `orphanGraceMs` (7 days), never while an instance uses it. A bot that turns out to exist again clears the mark.
- **Root disk.** Every VM's root disk is `rootDiskGiB` (16 GiB): the base image uses 3.1 GiB of it on a fresh VM (measured; about 4.2 GiB with the desktop packages), which leaves some 12 GiB for what a bot installs with apt or npm and their caches; the bot's own files are on the workspace volume.

### The base image

Bot VMs start from the image alias `image` (`dsh-bot-base`) of the project. With `manageImage` (the default) the plugin puts it there itself (src/host/image/, docs/specs/incus-endpoint.md §5.5), from the release this version names: `infra/release.env`'s `IMAGE_TAG` and `IMAGE_MANIFEST_SHA256`, copied into `src/host/image/release-env.ts` by `infra/vm/export-image.sh` (a test keeps them equal). The checks:

1. `manifest.txt` from `https://github.com/1outres/dsh-bots/releases/download/<tag>/` (or `imageBaseUrl`, with `imageManifestSha256`) must have that sha256, format 1, the DSH version the plugin runs on, one `image` and parts whose sizes add up to it. The verified manifest is kept in `<stateDir>/images/manifests/`, so a VM host that has the image needs no network.
2. When the alias already points at the manifest's fingerprint, nothing happens. When the project has the image without the alias, only the alias moves.
3. Each part is downloaded into `<stateDir>/images/downloads/<manifest sha256>/<part>.partial` and continued with a `Range` request after a failure (a server that answers `200` sends it anew); a download that sends no byte for 60 s fails. It must have the manifest's size and sha256 (otherwise it is deleted), and is then renamed to `<part>`; a part already there is hashed again, not downloaded. The disk must have room for what is left, before anything is downloaded.
4. The joined parts must have the manifest's image sha256 (= the Incus fingerprint); then they are streamed to `POST /1.0/images` (`imageUploadTimeoutMs`), and Incus must report that same fingerprint (an image with another one is deleted again).
5. The alias is pointed at it; the image it pointed at before is deleted when no other alias names it. The downloads, and those of other releases, are removed.

There is one import at a time. `ensure` waits for it only before it creates a VM, reporting the phase `image`; a failure fails the ensure with the reason and its fix. A waiting ensure's abort stops only its wait. The settings screen reads the state and starts or cancels the import through `BotEnvironmentImageHost` (`@1outres/dsh-bot-core`'s `shared/environment-image.ts`). A cancelled or failed import keeps the downloaded bytes, and the next one continues from them. With `manageImage` off the alias is used as it is (an image built with `infra/vm/build-base-image.sh`), and ensure fails while it is missing.

Fail closed: `ensure` first checks the endpoint and project (src/host/endpoint-check.ts: the Incus API answers and trusts this installation, Incus 6.0.4 or later with VM support, the project exists, is not `default` and, for a paired VM host, is restricted, and its `user.dsh-bots.pool` / `user.dsh-bots.network` can be used); it rejects with every problem and its fix otherwise, and bot-core keeps the bot's preset not ready.

## What `ensure` does

For bot `<id>`:

1. Generates, once, an ed25519 client key and a host key under `<stateDir>/bots/<id>/` (mode 0600, directories 0700) and writes `known_hosts` pinning the host key under the alias `dsh-bot-<id>`. A lost `.pub` is derived again; a lost private key is never replaced while the VM exists.
2. Creates the workspace volume (or grows it, see above) and the Incus VM `<instancePrefix><id>` from the image alias in the project, everything written into the instance itself, no profiles (docs/specs/incus-endpoint.md §3.4): `limits.cpu`, `limits.memory`, `security.guestapi=false`, `security.secureboot=false`, `boot.autostart`, the root disk on the declared pool, the NIC `eth0` on the declared network with `security.port_isolation`, `mac_filtering` and `ipv4_filtering`, and the `workspace` disk; tagged `user.dsh-bot.id` and `user.dsh-bot.owner` (the volume too). An instance or volume with that name but another id or owner is refused, never adopted. Its cloud-init user-data installs the client key for user `bot` and the host key, mounts the workspace, and ends with `sync`.
3. Writes `<stateDir>/ssh/<id>.conf`, the bot's whole OpenSSH client config: every `ssh` for the bot runs with `-F` on it, so neither `~/.ssh/config` nor `/etc/ssh/ssh_config` is read (`Host dsh-bot-<id>`, `ProxyCommand`, `ProxyUseFdpass no`, `IdentityFile`, `UserKnownHostsFile`, `HostKeyAlias`, `IdentitiesOnly`, `StrictHostKeyChecking yes`). The `ProxyCommand` is this package's `lib/guest-proxy.js` run by DSH's Node: it connects to the relay this DSH process listens on (`<stateDir>/run/guest.sock`, directory 0700), names the instance, and then carries the bytes of `/usr/sbin/sshd -i` that the relay runs in the VM as root through Incus' exec API (`src/host/guest-transport.ts`, `src/node/guest-relay.ts`). The relay serves only running instances this installation created for a bot. Nothing in the VM listens for SSH, and only the DSH process talks to Incus: no Incus key is written to a file and the ProxyCommand carries no secret. SSH's own key authentication and host key pinning stay as they are.
4. Waits until `ssh` (as `bot`) finds cloud-init's boot finished and the `workspace` the mounted volume, writable (`readyTimeoutMs`; a first boot from a new image can take minutes). A new VM boots twice (the first boot restarts within seconds, before cloud-init runs), so this is only seen on the final boot.
5. Starts dsh-ssh's helper once, as a session's connection does (`node --disable-sigusr1 <helper>` in the `workspace`, no input, so it exits once loaded). On a VM that just booted from a fresh copy of the image, everything the helper loads is read cold: measured 6–9 s for that first start on this Host (more on a busy one), against dsh-ssh's 60 s handshake deadline; afterwards a handshake takes about 0.5 s. A failure here is only logged.
6. Links, inside the VM, the ripgrep path the Host's DSH spawns for grep and glob (`resolveRgPath()` of `@deepseek-ai/dsh-util-ripgrep`, which depends on where DSH is installed) to `guestRipgrep` (`sudo -n ln -sfn` as `bot`; nothing when the link is already there); a failure fails the ensure. The image therefore carries no DSH of its own.
7. Measures the VM's egress (see The VM host); it only reports.

**The bot's spec** (docs/specs/bot-vm-spec.md). bot-core's target carries the bot's `spec` (`cpus`, `memoryMiB`, `diskGiB` = the workspace volume). `ensure` compares the instance's own config and devices with what the bot needs (src/host/reconfigure.ts): when they differ, a running VM is stopped, changed and started again; CPU or memory written another way but meaning the same (`6GiB` for `6144MiB`) is written without a stop. Changes are written with a whole-instance `PUT`; when Incus refuses one, a VM stopped for it is started again before the ensure fails. `capacity()` gives bot-core the ranges (src/host/capacity.ts): 1 to the server's CPUs and the project's `limits.cpu`; 1 GiB to three quarters of the server's memory and what the project's `limits.memory` leaves beside the other instances, in steps of 512 MiB; 1 GiB to what the pool and the project's `limits.disk` / `limits.disk.pool.<pool>` leave beside the root disk, grow only. `inspect(botId)` reports what a bot's VM and volume run with.

Calls for one bot are serialized, and at most `maxConcurrentProvisions` VMs are created or booted at once (all bots are ensured at start-up). The plugin also:

- every `watchIntervalMs` checks that bots whose last `ensure` succeeded still run; a stopped one is reported through `onChange`, and bot-core ensures it again;
- `reconcileDelayMs` after start, then every `reconcileIntervalMs`, looks at the instances and workspace volumes it owns whose bot no longer exists (bots bot-core lists or ensured in this process are kept): it stops the instance and marks it and the volume `user.dsh-bot.orphaned=<time>`, and deletes them (the instance with its keys and config) once marked longer than `orphanGraceMs`. A bot that reappears clears the marks. Instances and volumes it does not own are never touched.

Incus is driven through its REST API (`src/host/incus.ts`), always naming the project. `ssh-keygen` and `ssh` run as child processes.

### The VM host

Where the VMs run is chosen in the dsh-bots settings, section **VM host** (bot-core's `botEnvironmentHost` Remote; this package's `BotEnvironment.host`, `src/host/vm-host.ts`; docs/specs/incus-endpoint.md §3, §4):

- **Stored choice.** `<stateDir>/endpoint.json` (0600, version 2) holds the endpoint and its project: this machine's socket, or a paired VM host (its URL, the server certificate's SHA-256 pinned at pairing, this installation's client certificate). The client key is in DSH's credential store (`bot-vm/incus-client`, §6.2). With nothing stored, it is this machine's `incusSocket` and `incusProject`. A file of another version is reported (`stored-unreadable`) and nothing runs until the VM host is chosen again.
- **Switching.** Every Incus call goes to the client of the choice at that moment (`src/host/endpoint-scope.ts`, `src/host/switchable-incus.ts`), so the environment and the image import follow a change without a restart. A change closes the earlier connection (its operations' websockets too, so the SSH relays end), asks bot-core to ensure every bot again (`rehome`: they get VMs there; their files stay where they were, and their VMs on the earlier VM host keep running until removed there), cancels a running image import and looks at the image again, and checks the new place.
- **Pairing.** The settings read the trust token first (its server fingerprint, addresses, expiry; nothing is sent), then pair with the chosen address (a typed URL for a VM host behind NAT) and project: the TLS connection is refused unless the server certificate's SHA-256 is the token's (src/host/pairing.ts).
- **Leaving.** A restricted certificate cannot remove itself (§4): leaving a paired VM host (Stop using it, This machine, or pairing another) forgets it here and lists `incus config trust remove <first 12 of the fingerprint>` to run there (kept in memory until DSH restarts).
- **Check.** The settings show `checkEndpoint`'s result: each problem's code, message and fix.
- **Egress** (§6.4). The project's declared `user.dsh-bots.egress-acl` (a warning when missing) and, after every ensure, what the VM itself reached (src/host/egress-probe.ts): from inside the VM, two-second TCP connections at once to its gateway (ports 22, 80, 443, 8443) and one address each of `10/8`, `172.16/12`, `192.168/16`, `100.64/10` and `169.254.169.254`; an established one is a warning, the bot keeps running.

## Rows

```yaml
- {
    id: env-ssh,
    name: "@1outres/dsh-bot-vm/ssh",
    config:
      {
        host: dsh-bot-<id>,
        configFile: <stateDir>/ssh/<id>.conf,
        launch: { kind: node-script, node: /usr/bin/node },
        helper: <helper>,
        helperHash: <sha256>,
        workspace: /home/bot/workspace,
        requestTimeoutMs: 60000,
      },
  }
- {
    id: env-sandbox-policy,
    name: "@1outres/dsh-bot-vm/full-access-policy",
    config: { workspaceRoot: /home/bot/workspace },
  }
- { id: env-fs, name: "@1outres/dsh-bot-vm/fs" }
- { id: env-subprocess, name: "@deepseek-ai/dsh-subprocess-ssh" }
- { id: env-shell, name: "@deepseek-ai/dsh-bash-local", config: { cwd: /home/bot/workspace } }
```

- **`./ssh`** provides `ssh` with the API of `@deepseek-ai/dsh-ssh`'s service (`request`, `connectStream`, `ready`, `ptcLaunch`, `dispose`), so `dsh-fs-ssh` and `dsh-subprocess-ssh` run on it unchanged (`test/ssh-providers.test.ts` runs them with dsh-ssh's real helper). The connection is this package's copy of dsh-ssh 0.2.2-rc.5's Host side (`src/node/ssh/connection.ts`, MIT, `src/node/ssh/LICENSE.dsh-ssh`), changed only to run `ssh -F <configFile>`; the helper, `@deepseek-ai/dsh-ssh/protocol` and `/schemas` stay dsh-ssh's. When DSH moves to another dsh-ssh, diff its `src/index.ts` against the copy. The service opens a connection on first use, so a preset mounts while the VM is down, and opens a new one after a connection failed. Calls in flight at a failure still fail; nothing is replayed. Process and stream handles stay with the connection that issued them: a call for a handle of a lost connection is answered locally (a release resolves, anything else fails) and never reaches the new connection. Each call tries connecting `connectAttempts` times (2) before it fails; after a call failed to connect, calls fail fast for `retryDelayMs` (2 s). The error ("cannot reach the bot VM over SSH (<alias>): <reason>") carries the reason in its message only. `dispose()` closes the current connection only when the latest failed call ran on it. A connection with no call in flight, no open stream and no remote process for `idleMs` (5 min) is closed: an open one holds an Incus exec operation, which makes an incusd restart wait (docs/specs/incus-endpoint.md §8.2).
- **`./full-access-policy`** is `@deepseek-ai/dsh-sandbox-policy`'s service with every resolution forced to `danger-full-access` (bot-core's `BOT_PERMISSION` sandbox): the bot owns its VM, so file tools never ask for approval, whatever the session's permission preset says. It also keeps the group's workspace root and is what dsh-fs-ssh sends with every mutation.
- **`./fs`** is `@deepseek-ai/dsh-fs-ssh`'s file system declaring that it does not confine (`sandboxMode` undefined, as dsh-fs defines a non-confining backend). DSH's `edit`, `write` and `apply_patch` therefore carry no `sandbox_permissions` / `justification` and resolve no policy of their own; dsh-fs-ssh still resolves the group's full-access policy for the helper. (With dsh-fs-ssh itself, which reports the policy's default mode, the tools advertised an escalation the VM never needs.) `bash` already had none: `dsh-bash-local` does not confine either.

## Config

| Field                     | Default                                                                                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stateDir`                | `~/.dsh/bots-vm` (keys, `ssh/<id>.conf`, the relay's `run/guest.sock`, `images/`)                                                                                                                               |
| `owner`                   | empty: the id in `<stateDir>/owner`, created once (random; an installation of an earlier version, with `<stateDir>/bots` but no owner file, keeps the hash of the real `stateDir` path its VMs are tagged with) |
| `incusSocket`             | `/var/lib/incus/unix.socket` (this machine's Incus, while no VM host is paired)                                                                                                                                 |
| `incusProject`            | `dsh-bots` (made for dsh-bots, docs/specs/incus-endpoint.md §3.4; `default` is refused)                                                                                                                         |
| `incusTimeoutMs`          | `30000` (per API request)                                                                                                                                                                                       |
| `operationTimeoutMs`      | `900000` (per create/start/stop/delete)                                                                                                                                                                         |
| `maxConcurrentProvisions` | `2` (VMs created or booted at once; waiting follows the ensure's abort)                                                                                                                                         |
| `image`                   | `dsh-bot-base`                                                                                                                                                                                                  |
| `manageImage`             | `true` (import the release's base image, see above; off: use the alias as it is)                                                                                                                                |
| `imageBaseUrl`            | empty: the GitHub release `IMAGE_TAG` (set with `imageManifestSha256` for a mirror)                                                                                                                             |
| `imageManifestSha256`     | empty: `IMAGE_MANIFEST_SHA256`                                                                                                                                                                                  |
| `imageUploadTimeoutMs`    | `3600000` (sending the image to Incus)                                                                                                                                                                          |
| `rootDiskGiB`             | `16` (every VM's root disk; the bot's files are on its workspace volume, `diskGiB`)                                                                                                                             |
| `instancePrefix`          | `dsh-bot-`                                                                                                                                                                                                      |
| `hostAliasPrefix`         | `dsh-bot-`                                                                                                                                                                                                      |
| `guestRipgrep`            | `/usr/bin/rg` (the VM's ripgrep, which DSH's own ripgrep path is linked to in every VM)                                                                                                                         |
| `guestUser`               | `bot`                                                                                                                                                                                                           |
| `workspace`               | `/home/bot/workspace` (every bot session's cwd in its VM; `BotEnvironment.workspace`)                                                                                                                           |
| `guestNode`               | `/usr/bin/node`                                                                                                                                                                                                 |
| `helper`                  | `/opt/dsh-ssh-helper/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js`                                                                                                                                           |
| `helperHash`              | sha256 of dsh-ssh 0.2.2-rc.5's `lib/helper.js`                                                                                                                                                                  |
| `requestTimeoutMs`        | `60000` (dsh-ssh)                                                                                                                                                                                               |
| `readyTimeoutMs`          | `1200000`                                                                                                                                                                                                       |
| `watchIntervalMs`         | `60000` (0 = off)                                                                                                                                                                                               |
| `reconcileDelayMs`        | `60000` (0 = no clean-up)                                                                                                                                                                                       |
| `reconcileIntervalMs`     | `3600000`                                                                                                                                                                                                       |
| `orphanGraceMs`           | 7 days                                                                                                                                                                                                          |

## Requirements

On the DSH host (any system DSH runs on): OpenSSH's client (`ssh`, `ssh-keygen`) on DSH's PATH. Nothing in `~/.ssh/config`, no Incus, no root.

A VM host (docs/specs/incus-endpoint.md §2, §3), prepared by the repository's `install.sh` (Debian 13 / 12, Ubuntu 24.04, Fedora 42+; `infra/vm/README.md`) or, on an Incus server that runs other things, by its administrator with `infra/incus/create-project.sh`:

- Incus 6.0.4 or later with VM support; for this machine, the DSH user in `incus-admin`; for another one, its HTTPS API reachable from the DSH host and a trust token restricted to the project.
- The project (`incusProject`, or the one chosen when pairing) with `user.dsh-bots.pool` and `user.dsh-bots.network` naming a pool and a network it may use (and `user.dsh-bots.egress-acl` the ACL on that network).
- The `dsh-bot-base` image, which the plugin imports itself (The base image): user `bot` with `/home/bot/workspace`, Node 24, `/usr/sbin/sshd` (run as `sshd -i` through Incus' exec), the cloud-init seed made root-only on every boot (it carries the host's private key), `/opt/dsh-ssh-helper` (dsh-ssh 0.2.2-rc.5), ripgrep at `/usr/bin/rg`, passwordless sudo for `bot` (the ripgrep link).

## Deployment

Install a packed tarball into the DSH profile, not a `link:` to this repository:

```
pnpm build
pnpm --filter @1outres/dsh-bot-vm pack      # -> 1outres-dsh-bot-vm-<version>.tgz
```

Add that tarball to the profile together with `@1outres/dsh-bot-core`, which the profile must hold exactly once. `@deepseek-ai/dsh-ssh`, `@deepseek-ai/dsh-fs-ssh` and `@deepseek-ai/dsh-subprocess-ssh` (exactly 0.2.2-rc.5) are dependencies: DSH does not ship them and profiles install no peers (`autoInstallPeers: false`), so `dsh plugin add` brings them (hoisted, once); `cordis`, `dsh-sandbox-policy` and `dsh-util-ripgrep` come with DSH. Users install the `@1outres/dsh-bots` bundle from npm instead (see the repository's README).

The built `lib/*.js` contain only this package's code (bot-core is imported for its types only; `test/packages-bundle.test.ts` checks it).
