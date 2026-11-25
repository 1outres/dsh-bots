# @1outres/dsh-bot-vm

Gives every bot its own Incus VM. Bot Agents run `bash`, read/write/edit, grep/glob, jobs, AGENTS.md and filesystem skills inside that VM over SSH; nothing of theirs runs on the Host.

The plugin (row `bot-vm`, `inject = ["bot"]`) registers the `incus-vm` environment with `@1outres/dsh-bot-core`. bot-core asks it to `ensure` every bot and puts the environment's rows into the bot's preset as an isolated group (`ssh`, `fs`, `subprocess`, `shell`, `sandboxPolicy`).

Every bot session's cwd is the environment's `workspace`, `/home/bot/workspace` inside the bot's VM (the same path in every VM). That directory is shared from the Host: it is `<hostRoot>/<id>/workspace` (default `~/.dsh/bots/<id>/workspace`), an Incus disk device the VM mounts over virtiofs, so the user sees, edits and backs up the bot's files on the Host as they change. Sessions still only know the guest path; nothing of a bot runs on the Host, and bot-core never uses a Host path for a bot.

### The share

- **Ownership.** The VM's `raw.idmap` (`uid <DSH uid> <guestUid>`, `gid <DSH gid> <guestGid>`; the image's `bot` is 1001) makes virtiofsd map the guest user to the DSH user: everything `bot` writes is the DSH user's on the Host, and the Host user's files are `bot`'s in the VM. virtiofsd refuses every other guest id in the share, so **root in the VM cannot create files, directories or device nodes there, nor chown** (it gets `EIO`, e.g. from `sudo touch`); it can still read and write existing files. Files that another Host user (root) puts there show with their Host ids in the VM. With an id map Incus disables the 9p fallback; the device also says `io.bus=virtiofs`.
- **Host safety.** `ensure` refuses to share from a directory whose mount lacks `nosuid` or `nodev` (`/proc/self/mountinfo`): a setuid binary or device node made in the VM must stay inert on the Host. `infra/vm/host-setup.sh` bind-mounts `~/.dsh/bots` onto itself with `nosuid,nodev,nosymfollow` (`nosymfollow`: Host processes never follow a symlink a bot made; inside the VM symlinks work as usual) and makes `incus.service` require that mount. virtiofsd runs sandboxed (its own mount namespace whose root is the shared directory, seccomp, reduced capabilities): `..`, absolute symlinks and hard links resolve inside the VM or fail (`EXDEV`), never reach another Host directory.
- **Directories.** `ensure` creates `<hostRoot>` and `<hostRoot>/<id>` (mode 0700) and the `workspace` (0755) before it creates or starts the VM (Incus refuses to start a VM whose share source is missing).
- **Lifetime.** Deleting a bot (`remove`) or the orphan clean-up deletes the VM, keys and ssh config but **never the Host directory**: a deleted bot's files stay in `<hostRoot>/<id>/workspace` until the user removes them. A bot created again with the same id would find them.
- **Speed** (measured on this Host, virtiofs `cache=never`, Incus' default): creating 2000 small files 1.7 s (0.05 s on the VM's own disk), reading them back 2.1 s, writing 512 MiB 380 MB/s.

Fail closed: without a working Incus (socket, image, profile) or SSH path, `ensure` rejects and bot-core keeps every bot preset not ready; bot Agents then run no tools at all.

## What `ensure` does

For bot `<id>`:

1. Generates, once, an ed25519 client key and a host key under `<stateDir>/bots/<id>/` (mode 0600, directories 0700) and writes `known_hosts` pinning the host key under the alias `dsh-bot-<id>`. A lost `.pub` is derived again; a lost private key is never replaced while the VM exists.
2. Creates the Incus VM `dsh-bot-<id>` from the image alias and profiles, tagged `user.dsh-bot.id` and `user.dsh-bot.owner` (or starts / unfreezes it). An instance with that name but another id or owner is refused, never adopted. The VM gets the share (device `workspace`, `raw.idmap`, see above). Its cloud-init user-data installs the client key for user `bot` and the host key, creates the `workspace` for `bot` if the image lacks it, and ends with `sync`. A VM of an earlier version (no share, or a different one) is stopped, given the share and started again; what it had in its own `/home/bot/workspace` stays on its disk, hidden under the mount (Incus refuses to change `raw.idmap` of a running VM, and detaching a mounted share from a running VM fails and leaves the guest's mount hanging, so the plugin never hot-plugs).
3. Writes `<stateDir>/ssh/<id>.conf`, the bot's whole OpenSSH client config: every `ssh` for the bot runs with `-F` on it, so neither `~/.ssh/config` nor `/etc/ssh/ssh_config` is read (`Host dsh-bot-<id>`, `ProxyCommand`, `ProxyUseFdpass no`, `IdentityFile`, `UserKnownHostsFile`, `HostKeyAlias`, `IdentitiesOnly`, `StrictHostKeyChecking yes`). The `ProxyCommand` is this package's `lib/guest-proxy.js` run by DSH's Node: it connects to the relay this DSH process listens on (`<stateDir>/run/guest.sock`, directory 0700), names the instance, and then carries the bytes of `/usr/sbin/sshd -i` that the relay runs in the VM as root through Incus' exec API (`src/host/guest-transport.ts`, `src/node/guest-relay.ts`). The relay serves only running instances this installation created for a bot. Nothing in the VM listens for SSH, and only the DSH process talks to Incus: no Incus key is written to a file and the ProxyCommand carries no secret. SSH's own key authentication and host key pinning stay as they are.
4. Waits until `ssh dsh-bot-<id>` (as `bot`) finds cloud-init's boot finished and the `workspace` a writable directory (`readyTimeoutMs`; a first boot from a new image can take minutes). A new VM boots twice (the first boot restarts within seconds, before cloud-init runs), so this is only seen on the final boot.
5. Starts dsh-ssh's helper once, as a session's connection does (`node --disable-sigusr1 <helper>` in the `workspace`, no input, so it exits once loaded). On a VM that just booted from a fresh copy of the image, everything the helper loads is read cold: measured 6–9 s for that first start on this Host (more on a busy one), against dsh-ssh's 30 s handshake deadline; afterwards a handshake takes about 0.5 s. A failure here is only logged.
6. Links, inside the VM, the ripgrep path the Host's DSH spawns for grep and glob (`resolveRgPath()` of `@deepseek-ai/dsh-util-ripgrep`, which depends on where DSH is installed) to `guestRipgrep` (`sudo -n ln -sfn` as `bot`; nothing when the link is already there); a failure fails the ensure. The image therefore carries no DSH of its own.

**The bot's spec** (docs/specs/bot-vm-spec.md). bot-core's target carries the bot's `spec` (`cpus`, `memoryMiB`, `diskGiB`), and the instance's own config is where it is applied: `limits.cpu`, `limits.memory` (`<n>MiB`) and its own root disk device (the profiles' root, same pool, `size: <n>GiB`); the profiles are never changed and only give the root's pool. A new VM is created stopped, given the spec and then started. For an existing one `ensure` compares the spec with what the VM runs with (`expanded_config` / `expanded_devices`, profiles included; Incus's own 1 vCPU / 1 GiB where nothing sets a value; `src/host/reconfigure.ts`): when it differs, a running VM is stopped, changed and started again; when only the way it is written differs (the profiles' values, `4GiB` for `4096MiB`), it is written without a stop. A root disk smaller than the VM's is refused (Incus cannot shrink a block volume). Measured on Incus 6.0.4: written live, a larger disk or more CPUs are not seen by the guest until it restarts and more memory is refused (`Cannot increase memory size beyond boot time size`), while the same values written live change nothing in the running VM. After a restart with a larger disk, cloud-init's `growpart` and `resizefs` (which run on every boot in the Debian cloud image) grow the partition and ext4 (20 → 24 GiB: `df /` 19679M → 23650M). Changes are written with a whole-instance `PUT` (read, change, write back), never `PATCH`; when Incus refuses one, a VM stopped for it is started again before the ensure fails. `capacity()` gives bot-core the ranges (`src/host/capacity.ts`: 1 to the Host's logical CPUs; 1 GiB to three quarters of its memory and at most what the project's `limits.memory` leaves beside the other instances, in steps of 512 MiB; 10 GiB to the root pool's size, grow only), read from `/1.0/resources`, the project, the profiles and the pool. `inspect(botId)` reports what a bot's VM runs with, which bot-core stores once as the spec of a bot stored before ... (line truncated to 2000 chars)

Calls for one bot are serialized, and at most `maxConcurrentProvisions` VMs are created or booted at once (all bots are ensured at start-up). `remove` deletes the VM only if it carries this bot's id and this owner, then the keys and the ssh config (only a config with the managed header); the shared workspace stays on the Host. The plugin also:

- every `watchIntervalMs` checks that bots whose last `ensure` succeeded still run; a stopped one is reported through `onChange`, and bot-core ensures it again;
- `reconcileDelayMs` after start, then every `reconcileIntervalMs`, looks at the instances it owns whose bot no longer exists (bots bot-core lists or ensured in this process are kept): it stops one and marks it `user.dsh-bot.orphaned=<time>`, and deletes it with its keys and config (never its Host workspace) once marked longer than `orphanGraceMs`. A bot that reappears clears the mark. Files and instances it does not own are never touched.

Incus is driven through its REST API (`src/host/incus.ts`; the Unix socket, or HTTPS with a pinned server certificate, `src/node/incus-transport.ts`), with a deadline per request; `ssh-keygen` and `ssh` run as child processes.

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
        requestTimeoutMs: 30000,
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
| `stateDir`                | `~/.dsh/bots-vm` (keys, `ssh/<id>.conf`, the relay's `run/guest.sock`)                                                                                                                                          |
| `hostRoot`                | `~/.dsh/bots` (shared workspaces `<hostRoot>/<id>/workspace`; mounted `nosuid,nodev`)                                                                                                                           |
| `guestUid` / `guestGid`   | `1001` / `1001` (the image's `bot`; mapped to the DSH user's ids in the share)                                                                                                                                  |
| `owner`                   | empty: the id in `<stateDir>/owner`, created once (random; an installation of an earlier version, with `<stateDir>/bots` but no owner file, keeps the hash of the real `stateDir` path its VMs are tagged with) |
| `incusSocket`             | `/var/lib/incus/unix.socket`                                                                                                                                                                                    |
| `incusProject`            | `default`                                                                                                                                                                                                       |
| `incusTimeoutMs`          | `30000` (per API request)                                                                                                                                                                                       |
| `operationTimeoutMs`      | `300000` (per create/start/stop/delete)                                                                                                                                                                         |
| `maxConcurrentProvisions` | `2` (VMs created or booted at once; waiting follows the ensure's abort)                                                                                                                                         |
| `image`                   | `dsh-bot-base`                                                                                                                                                                                                  |
| `profiles`                | `[dsh-bot]`                                                                                                                                                                                                     |
| `instancePrefix`          | `dsh-bot-`                                                                                                                                                                                                      |
| `hostAliasPrefix`         | `dsh-bot-`                                                                                                                                                                                                      |
| `guestRipgrep`            | `/usr/bin/rg` (the VM's ripgrep, which DSH's own ripgrep path is linked to in every VM)                                                                                                                         |
| `guestUser`               | `bot`                                                                                                                                                                                                           |
| `workspace`               | `/home/bot/workspace` (every bot session's cwd in its VM; `BotEnvironment.workspace`)                                                                                                                           |
| `guestNode`               | `/usr/bin/node`                                                                                                                                                                                                 |
| `helper`                  | `/opt/dsh-ssh-helper/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js`                                                                                                                                           |
| `helperHash`              | sha256 of dsh-ssh 0.2.2-rc.5's `lib/helper.js`                                                                                                                                                                  |
| `requestTimeoutMs`        | `30000` (dsh-ssh)                                                                                                                                                                                               |
| `readyTimeoutMs`          | `480000`                                                                                                                                                                                                        |
| `watchIntervalMs`         | `60000` (0 = off)                                                                                                                                                                                               |
| `reconcileDelayMs`        | `60000` (0 = no clean-up)                                                                                                                                                                                       |
| `reconcileIntervalMs`     | `3600000`                                                                                                                                                                                                       |
| `orphanGraceMs`           | 7 days                                                                                                                                                                                                          |

## Requirements

The Host set up by `infra/vm` of this repository:

- Incus with VM support and `virtiofsd`; the DSH process (not root) can use the Incus socket.
- `~/.dsh/bots` (`hostRoot`) mounted `nosuid,nodev` (`host-setup.sh`: a self bind mount with `nosymfollow` too, required by `incus.service`).
- The `dsh-bot` profile (`security.guestapi=false`) and the `dsh-bot-base` image: user `bot` with `/home/bot/workspace`, Node 24, `/usr/sbin/sshd` (run as `sshd -i` through Incus' exec; the image's `sshd-vsock.socket` is no longer used), the cloud-init seed made root-only on every boot (it carries the host's private key), `/opt/dsh-ssh-helper` (dsh-ssh 0.2.2-rc.5), ripgrep at `/usr/bin/rg`, passwordless sudo for `bot` (the ripgrep link).
- OpenSSH's client (`ssh`, `ssh-keygen`) on DSH's PATH. Nothing in `~/.ssh/config`.

## Deployment

Install a packed tarball into the DSH profile, not a `link:` to this repository:

```
pnpm build
pnpm --filter @1outres/dsh-bot-vm pack      # -> 1outres-dsh-bot-vm-<version>.tgz
```

Add that tarball to the profile together with `@1outres/dsh-bot-core`, which the profile must hold exactly once. `@deepseek-ai/dsh-ssh`, `@deepseek-ai/dsh-fs-ssh` and `@deepseek-ai/dsh-subprocess-ssh` (exactly 0.2.2-rc.5) are dependencies: DSH does not ship them and profiles install no peers (`autoInstallPeers: false`), so `dsh plugin add` brings them (hoisted, once); `cordis`, `dsh-sandbox-policy` and `dsh-util-ripgrep` come with DSH. Users install the `@1outres/dsh-bots` bundle from npm instead (see the repository's README).

The built `lib/*.js` contain only this package's code (bot-core is imported for its types only; `test/packages-bundle.test.ts` checks it).
