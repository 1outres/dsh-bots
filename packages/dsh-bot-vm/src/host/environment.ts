/**
 * The `incus-vm` bot environment: one Incus VM per bot, reached over SSH
 * whose transport is `sshd -i` run through Incus' exec API
 * (src/host/guest-transport.ts). All I/O (Incus, files, child processes, clock) is
 * injected by src/index.ts.
 */
import type {
  BotEnvironment,
  BotEnvironmentCapacity,
  BotEnvironmentTarget,
  EnsureOptions,
  EnvironmentPhase,
} from "@1outres/dsh-bot-core"
import { capacityOf } from "./capacity"
import { BOOT_FINISHED, isCanonicalPath, userDataText } from "./cloud-init"
import { checkInstanceName, type GuestProxy, proxyCommandOf, SSHD_COMMAND } from "./guest-transport"
import type { ExecSession, IncusClient, IncusDevice, IncusInstance } from "./incus"
import { createLimiter } from "./limit"
import { type InstanceWants, type Reconfiguration, reconfigure } from "./reconfigure"
import { environmentRows, hostAliasOf, ISOLATED_SERVICES, type RowSettings } from "./rows"
import { createSerializer } from "./serial"
import { CPU_KEY, instanceSizesOf, MEMORY_KEY, ROOT_DEVICE, specOfInstance } from "./spec"
import { knownHostsText, MANAGED_HEADER, shellQuote, sshConfigText } from "./ssh-config"

export const ENVIRONMENT_ID = "incus-vm"

/** Where each bot's OpenSSH config (`ssh -F`) lives. */
export const sshConfigDirOf = (stateDir: string) => `${stateDir}/ssh`

/** Host files under the state directory. Paths are absolute. */
export interface EnvironmentFiles {
  /** File contents, or `undefined` when it does not exist. */
  read(path: string): Promise<string | undefined>
  /** Replace a file atomically with the given mode. */
  write(path: string, content: string, mode: number): Promise<void>
  /** Create a directory (and parents) with the given mode. */
  mkdir(path: string, mode: number): Promise<void>
  /** Remove a file or directory tree; missing is fine. */
  remove(path: string): Promise<void>
}

export interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export type RunCommand = (
  file: string,
  args: readonly string[],
  options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number },
) => Promise<CommandResult>

/** The Host mount a path lies on. */
export interface HostMount {
  /** Mount point. */
  readonly target: string
  /** Per-mount options, e.g. `rw`, `nosuid`, `nodev`, `nosymfollow`. */
  readonly options: readonly string[]
}

export interface EnvironmentDeps {
  readonly incus: IncusClient
  /** The absolute ripgrep path the Host's DSH spawns, inside the bot's environment too. */
  readonly hostRipgrep: () => Promise<string>
  readonly files: EnvironmentFiles
  /** The mount `path` (which exists) lies on. */
  readonly mountOf: (path: string) => Promise<HostMount>
  readonly run: RunCommand
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly now: () => number
  readonly log: (message: string) => void
}

export interface EnvironmentSettings extends RowSettings {
  /** Absolute state directory (keys, known_hosts, state); `ssh/` under it holds each bot's ssh config. */
  readonly stateDir: string
  /**
   * Marks the instances this installation created (`user.dsh-bot.owner`).
   * Instances without this exact owner are never started, stopped or deleted.
   */
  readonly owner: string
  /** How long an instance of a deleted bot stays stopped before it is deleted. */
  readonly orphanGraceMs: number
  /** Incus instance name is `<instancePrefix><botId>`. */
  readonly instancePrefix: string
  readonly image: string
  readonly profiles: readonly string[]
  readonly guestUser: string
  /** The ProxyCommand reaching the guest's sshd through the relay. */
  readonly guestProxy: GuestProxy
  /** The guest's ripgrep; the Host DSH's ripgrep path is linked to it in every VM. */
  readonly guestRipgrep: string
  readonly readyTimeoutMs: number
  readonly probeIntervalMs: number
  /** VMs created or started (and waited for) at the same time, across all bots. */
  readonly maxConcurrentProvisions: number
  /**
   * Absolute Host directory holding every bot's shared workspace,
   * `<hostRoot>/<botId>/workspace`; it must lie on a `nosuid,nodev` mount.
   */
  readonly hostRoot: string
  /** Owner of the shared files on the Host (the DSH user); the guest user maps to it. */
  readonly hostUid: number
  readonly hostGid: number
  /** The guest user's ids in the image. */
  readonly guestUid: number
  readonly guestGid: number
}

/** Name of the Incus disk device that shares the workspace. */
export const WORKSPACE_DEVICE = "workspace"
/** Host mount options the share's mount must carry (guest root writes setuid files and device nodes). */
export const REQUIRED_MOUNT_OPTIONS = ["nosuid", "nodev"] as const

/**
 * What the provider remembers per bot, in `<stateDir>/bots/<id>/state.json`:
 * that it provisioned the bot's VM (an older `seeded` field is ignored).
 */
interface BotState {
  readonly version: 1
}

const BOT_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/
/** Incus instance names: a letter first, then letters, digits and hyphens. */
const INSTANCE_PREFIX = /^[a-zA-Z][a-zA-Z0-9-]*$/
/** dsh-ssh's `host` pattern. */
const ALIAS_PREFIX = /^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/
const MAX_INSTANCE_NAME = 63
/** The helper warm-up gets at least this long, even past the readiness deadline. */
const WARM_UP_MIN_MS = 120_000
/** A warm-up this slow is logged. */
const WARM_UP_LOG_MS = 5_000
/** ssh's own failure; any other exit code comes from the remote command. */
const SSH_FAILURE = 255

/** The environment plus the upkeep src/index.ts schedules. */
export interface VmEnvironment extends BotEnvironment {
  capacity(botId: string, signal?: AbortSignal): Promise<BotEnvironmentCapacity>
  onChange(listener: (botId: string) => void): () => void
  /**
   * Report every bot ensured in this process whose VM is no longer running
   * (stopped, deleted outside), so bot-core ensures it again.
   */
  poll(signal?: AbortSignal): Promise<void>
  /**
   * Retire the VMs of bots that no longer exist (deleted while no environment
   * was registered). Only instances this owner created for that bot id are
   * considered. `keep` lists the bots that do exist; bots ensured in this
   * process are always kept. A first pass stops the instance and marks it
   * orphaned; once marked longer than `orphanGraceMs`, the instance, its keys
   * and its (managed) ssh config are deleted. The bot's shared workspace on
   * the Host is never deleted.
   */
  reconcile(keep: Iterable<string>, signal?: AbortSignal): Promise<ReconcileResult>
  /**
   * The streams of `sshd -i` in a bot's VM, for the relay. Only a running
   * instance this owner created for a bot is reached.
   */
  openGuest(instance: string, signal?: AbortSignal): Promise<ExecSession>
}

export interface ReconcileResult {
  readonly marked: readonly string[]
  readonly removed: readonly string[]
}

export const CONFIG_BOT_ID = "user.dsh-bot.id"
export const CONFIG_OWNER = "user.dsh-bot.owner"
/** ISO time a reconcile found the bot gone; empty or absent while the bot exists. */
export const CONFIG_ORPHANED = "user.dsh-bot.orphaned"

export function createVmEnvironment(
  settings: EnvironmentSettings,
  deps: EnvironmentDeps,
): VmEnvironment {
  if (!INSTANCE_PREFIX.test(settings.instancePrefix)) {
    throw new Error(`instancePrefix "${settings.instancePrefix}" cannot start an Incus name`)
  }
  if (!ALIAS_PREFIX.test(settings.hostAliasPrefix)) {
    throw new Error(`hostAliasPrefix "${settings.hostAliasPrefix}" cannot start an SSH host alias`)
  }
  if (settings.owner === "") throw new Error("owner must not be empty")
  if (!isCanonicalPath(settings.workspace)) {
    throw new Error(`workspace "${settings.workspace}" is not a canonical absolute path`)
  }
  if (!isCanonicalPath(settings.hostRoot)) {
    throw new Error(`hostRoot "${settings.hostRoot}" is not a canonical absolute path`)
  }
  const serial = createSerializer()
  const provisions = createLimiter(settings.maxConcurrentProvisions)
  /** Bots ensure was called for in this process (and not removed since). */
  const seen = new Set<string>()
  /** Bots whose last ensure succeeded; only these are polled. */
  const healthy = new Set<string>()
  let polling = false
  /** Bots with an ensure running right now. */
  const busy = new Map<string, number>()
  const listeners = new Set<(botId: string) => void>()
  const { incus, files } = deps
  const botsDir = `${settings.stateDir}/bots`
  const sshDir = sshConfigDirOf(settings.stateDir)

  const paths = (botId: string) => {
    const dir = `${botsDir}/${botId}`
    return {
      dir,
      state: `${dir}/state.json`,
      key: `${dir}/id_ed25519`,
      hostKey: `${dir}/ssh_host_ed25519_key`,
      knownHosts: `${dir}/known_hosts`,
      conf: `${sshDir}/${botId}.conf`,
    }
  }

  const instanceOf = (botId: string) => `${settings.instancePrefix}${botId}`
  /** Host directory the bot's workspace is shared from. */
  const shareOf = (botId: string) => `${settings.hostRoot}/${botId}/workspace`

  /**
   * Incus config and device that share the workspace over virtiofs. virtiofsd
   * maps the guest user to the Host user and forbids every other guest id, so
   * every file in the share is the Host user's (guest root cannot create or
   * chown files there; it gets EIO). `io.bus=virtiofs`: no 9p fallback.
   */
  const shareConfig = () => ({
    "raw.idmap": `uid ${settings.hostUid} ${settings.guestUid}\ngid ${settings.hostGid} ${settings.guestGid}`,
  })
  const shareDevice = (botId: string): IncusDevice => ({
    type: "disk",
    source: shareOf(botId),
    path: settings.workspace,
    "io.bus": "virtiofs",
  })
  const wantsOf = (target: BotEnvironmentTarget): InstanceWants => ({
    shareConfig: shareConfig(),
    shareDevice: { name: WORKSPACE_DEVICE, device: shareDevice(target.id) },
    spec: target.spec,
  })

  /**
   * Create the bot's share directory (`<hostRoot>` and `<hostRoot>/<id>` 0700,
   * the workspace 0755) and check the mount it lies on: guest root can write
   * setuid-root binaries and device nodes into the share, which the Host
   * neutralizes only on a `nosuid,nodev` mount (infra/vm/host-setup.sh).
   */
  async function prepareShare(botId: string): Promise<void> {
    for (const [key, value] of Object.entries({
      hostUid: settings.hostUid,
      hostGid: settings.hostGid,
      guestUid: settings.guestUid,
      guestGid: settings.guestGid,
    })) {
      // Never map onto root (either side): the share's files would be root's.
      if (!Number.isInteger(value) || value <= 0 || value >= 2 ** 32 - 1) {
        throw new Error(`${key} must be a non-root user or group id, not ${value}`)
      }
    }
    await files.mkdir(settings.hostRoot, 0o700)
    await files.mkdir(`${settings.hostRoot}/${botId}`, 0o700)
    await files.mkdir(shareOf(botId), 0o755)
    const mount = await deps.mountOf(shareOf(botId))
    const missing = REQUIRED_MOUNT_OPTIONS.filter((option) => !mount.options.includes(option))
    if (missing.length > 0) {
      throw new Error(
        `${shareOf(botId)} lies on the mount ${mount.target} without ${missing.join(",")}; a bot's root could plant setuid files or device nodes there. Mount ${settings.hostRoot} with nosuid,nodev (infra/vm/host-setup.sh does) before bots start`,
      )
    }
  }

  function checkId(botId: string): void {
    if (!BOT_ID.test(botId) || instanceOf(botId).length > MAX_INSTANCE_NAME) {
      throw new Error(`bot id "${botId}" cannot name an Incus instance`)
    }
  }

  async function readState(path: string): Promise<BotState | undefined> {
    const text = await files.read(path)
    if (text === undefined) return undefined
    try {
      const value = JSON.parse(text) as Partial<BotState>
      if (value.version !== 1) return undefined
      return { version: 1 }
    } catch {
      return undefined
    }
  }

  const writeState = (path: string, state: BotState) =>
    files.write(path, `${JSON.stringify(state, null, 2)}\n`, 0o600)

  /**
   * An ed25519 key pair at `path` / `path.pub`, generated once. A lost public
   * half is derived again from the private key; a lost private key is only
   * replaced while no instance holds the old one (`mayCreate`).
   */
  async function keyPair(path: string, comment: string, mayCreate: boolean, signal?: AbortSignal) {
    let privateKey = await files.read(path)
    let publicKey = await files.read(`${path}.pub`)
    if (privateKey !== undefined && publicKey === undefined) {
      const derived = await deps.run("ssh-keygen", ["-y", "-f", path], { signal })
      if (derived.code !== 0)
        throw new Error(`ssh-keygen -y ${path} failed: ${derived.stderr.trim()}`)
      publicKey = `${derived.stdout.trim()} ${comment}\n`
      await files.write(`${path}.pub`, publicKey, 0o600)
    }
    if (privateKey === undefined || publicKey === undefined) {
      if (!mayCreate) {
        throw new Error(
          `${path} is missing while its VM exists; delete the VM to provision it again`,
        )
      }
      await files.remove(path)
      await files.remove(`${path}.pub`)
      const result = await deps.run(
        "ssh-keygen",
        ["-q", "-t", "ed25519", "-N", "", "-C", comment, "-f", path],
        { signal },
      )
      if (result.code !== 0) throw new Error(`ssh-keygen failed: ${result.stderr.trim()}`)
      privateKey = await files.read(path)
      publicKey = await files.read(`${path}.pub`)
      if (privateKey === undefined || publicKey === undefined) {
        throw new Error(`ssh-keygen did not write ${path}`)
      }
    }
    return { privateKey, publicKey: publicKey.trim() }
  }

  async function start(instance: IncusInstance, signal?: AbortSignal): Promise<void> {
    switch (instance.status) {
      case "Running":
        return
      case "Frozen":
        deps.log(`unfreezing ${instance.name}`)
        return incus.setState(instance.name, "unfreeze", signal)
      default:
        deps.log(`starting ${instance.name} (was ${instance.status})`)
        return incus.setState(instance.name, "start", signal)
    }
  }

  /** ssh as the bot's connection runs it: the bot's own config, never the user's. */
  const sshArgs = (alias: string, command: string) => [
    "-F",
    paths(alias.slice(settings.hostAliasPrefix.length)).conf,
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    "ConnectTimeout=10",
    alias,
    command,
  ]

  /**
   * Wait until ssh logs in through the alias, cloud-init's boot finished and
   * the workspace is a directory the guest user can write; then warm the
   * SSH helper up ({@link warmUp}).
   *
   * A new VM boots twice (the first boot restarts within seconds, before
   * cloud-init runs; cloud-init writes boot-finished on the second), so
   * boot-finished is never seen before the final boot.
   */
  async function waitForSsh(alias: string, signal?: AbortSignal): Promise<void> {
    const workspace = shellQuote(settings.workspace)
    const deadline = deps.now() + settings.readyTimeoutMs
    let last = ""
    for (;;) {
      signal?.throwIfAborted()
      const result = await deps.run(
        "ssh",
        sshArgs(alias, `test -e ${BOOT_FINISHED} && test -d ${workspace} && test -w ${workspace}`),
        { signal, timeoutMs: 30_000 },
      )
      if (result.code === 0) return warmUp(alias, deadline, signal)
      // Right after boot sshd may answer before cloud-init finished: retry both.
      last =
        result.code === SSH_FAILURE
          ? `did not answer over SSH: ${result.stderr.trim()}`
          : `answers over SSH but cloud-init has not finished or ${settings.workspace} is not a directory ${settings.guestUser} can write (exit ${result.code})`
      if (deps.now() >= deadline) {
        throw new Error(
          `the bot VM (${alias}) is not ready within ${settings.readyTimeoutMs} ms: it ${last}`,
        )
      }
      await deps.sleep(settings.probeIntervalMs, signal)
    }
  }

  /**
   * Start dsh-ssh's helper once, the way a bot session's connection will
   * (`node --disable-sigusr1 <helper>` in the workspace), with no input so it
   * exits as soon as it has loaded. On a VM that just booted from a fresh
   * copy of the image everything the helper loads is read cold: measured 6–9 s
   * for this first start, and more on a busy Host, against dsh-ssh's 30 s
   * handshake deadline (the E2E's first turn after creating a bot failed on
   * it). Afterwards a handshake takes about half a second. Advisory: a
   * failure here is logged, the connection itself is retried by the ssh row.
   */
  async function warmUp(alias: string, deadline: number, signal?: AbortSignal): Promise<void> {
    const started = deps.now()
    const command = `cd ${shellQuote(settings.workspace)} && ${shellQuote(settings.guestNode)} --disable-sigusr1 ${shellQuote(settings.helper)} </dev/null >/dev/null 2>&1; exit 0`
    const result = await deps.run("ssh", sshArgs(alias, command), {
      signal,
      timeoutMs: Math.max(deadline - started, WARM_UP_MIN_MS),
    })
    signal?.throwIfAborted()
    const took = deps.now() - started
    if (result.code !== 0) {
      deps.log(
        `warming up the SSH helper of ${alias} failed (exit ${result.code}): ${result.stderr.trim()}`,
      )
    } else if (took >= WARM_UP_LOG_MS) {
      deps.log(`the SSH helper of ${alias} took ${took} ms to start for the first time`)
    }
  }

  /** Whether an instance is the one this owner created for this bot. */
  const ours = (instance: IncusInstance, botId: string) =>
    instance.name === instanceOf(botId) &&
    instance.config[CONFIG_BOT_ID] === botId &&
    instance.config[CONFIG_OWNER] === settings.owner

  /** Delete our ssh config of a bot, only when it carries the managed header. */
  async function removeConf(botId: string): Promise<void> {
    const conf = paths(botId).conf
    const text = await files.read(conf)
    if (text?.startsWith(`${MANAGED_HEADER}\n`)) await files.remove(conf)
  }

  async function ensureOnce(target: BotEnvironmentTarget, options: EnsureOptions): Promise<void> {
    const { signal } = options
    const report = (phase: EnvironmentPhase) => options.progress?.(phase)
    const botId = target.id
    const name = instanceOf(botId)
    const alias = hostAliasOf(settings, botId)
    const file = paths(botId)
    await files.mkdir(settings.stateDir, 0o700)
    await files.mkdir(file.dir, 0o700)
    await files.mkdir(sshDir, 0o700)

    const state = await readState(file.state)
    const instance = await incus.instance(name, signal)
    if (instance !== undefined && !ours(instance, botId)) {
      throw new Error(
        `Incus instance "${name}" exists but was not created by this installation for bot ${botId} (${CONFIG_OWNER} differs); rename or delete it`,
      )
    }
    if (instance !== undefined && state === undefined) {
      throw new Error(
        `Incus instance "${name}" exists but its state under ${file.dir} is missing; delete it (incus delete --force ${name}) to provision it again`,
      )
    }

    await prepareShare(botId)

    const fresh = instance === undefined
    const client = await keyPair(file.key, alias, fresh, signal)
    const host = await keyPair(file.hostKey, `${alias} host key`, fresh, signal)
    await files.write(file.knownHosts, knownHostsText(alias, host.publicKey), 0o600)

    const existing =
      instance === undefined
        ? undefined
        : { instance, plan: reconfigure(instance, wantsOf(target)) }
    // Creating or booting VMs is heavy: only a few at a time (all bots ensure at start-up).
    const needsBoot =
      existing === undefined || existing.instance.status !== "Running" || existing.plan.stop
    const bring = () => bringUp(target, existing, { client, host }, report, signal)
    if (needsBoot) {
      report("queued")
      await provisions.run(bring, signal)
    } else await bring()
  }

  /** Carry out an existing instance's {@link Reconfiguration}; resolves with it as it is then. */
  async function reconfigureInstance(
    instance: IncusInstance,
    plan: Reconfiguration,
    signal?: AbortSignal,
  ): Promise<IncusInstance> {
    const { name } = instance
    const { change } = plan
    if (change === undefined) return instance
    const what = [
      ...(change.devices?.[WORKSPACE_DEVICE] === undefined
        ? []
        : [`sharing ${settings.workspace}`]),
      ...[CPU_KEY, MEMORY_KEY].flatMap((key) =>
        change.config?.[key] === undefined ? [] : [`${key} ${change.config[key]}`],
      ),
      ...(change.devices?.[ROOT_DEVICE] === undefined
        ? []
        : [`root disk ${change.devices[ROOT_DEVICE].size}`]),
    ]
    const how = plan.stop ? " (restarts the VM)" : plan.resizes ? "" : " (same values, no restart)"
    deps.log(`${name}: ${what.join(", ")}${how}`)
    if (plan.stop) await incus.setState(name, "stop", signal)
    try {
      await incus.update(name, change, signal)
    } catch (error) {
      // A refused change leaves the VM as it ran, not stopped.
      if (plan.stop) await incus.setState(name, "start")
      throw error
    }
    const updated = await incus.instance(name, signal)
    if (updated === undefined) throw new Error(`Incus instance "${name}" disappeared`)
    return updated
  }

  async function bringUp(
    target: BotEnvironmentTarget,
    existing: { readonly instance: IncusInstance; readonly plan: Reconfiguration } | undefined,
    keys: { client: { publicKey: string }; host: { privateKey: string; publicKey: string } },
    report: (phase: EnvironmentPhase) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const botId = target.id
    const name = instanceOf(botId)
    const alias = hostAliasOf(settings, botId)
    const file = paths(botId)
    const { client, host } = keys
    let instance: IncusInstance | undefined
    if (existing === undefined) {
      // A state without an instance means the VM was deleted: provision anew.
      await writeState(file.state, { version: 1 })
      report("creating")
      deps.log(`creating ${name} for bot ${target.id} (${target.name})`)
      await incus.create(
        {
          name,
          description: `dsh bot ${target.id}`,
          image: settings.image,
          profiles: settings.profiles,
          config: {
            "cloud-init.user-data": userDataText({
              user: settings.guestUser,
              workspace: settings.workspace,
              authorizedKey: client.publicKey,
              hostPrivateKey: host.privateKey,
              hostPublicKey: host.publicKey,
            }),
            // The user-data carries the host's private key: keep the guest API
            // (which serves cloud-init.* and user.* keys) away from the guest.
            "security.guestapi": "false",
            "boot.autostart": "true",
            [CONFIG_BOT_ID]: botId,
            [CONFIG_OWNER]: settings.owner,
            ...shareConfig(),
          },
          devices: { [WORKSPACE_DEVICE]: shareDevice(botId) },
          start: false,
        },
        signal,
      )
      const created = await incus.instance(name, signal)
      if (created === undefined) throw new Error(`Incus did not create "${name}"`)
      // Its own spec is written before its first boot: the root disk comes from the profiles' pool.
      instance = await reconfigureInstance(created, reconfigure(created, wantsOf(target)), signal)
      report("booting")
    } else {
      if ((existing.instance.config[CONFIG_ORPHANED] ?? "") !== "") {
        deps.log(`${name} belongs to an existing bot again; clearing its orphan mark`)
        await incus.patchConfig(name, { [CONFIG_ORPHANED]: "" }, signal)
      }
      instance = await reconfigureInstance(existing.instance, existing.plan, signal)
      if (instance.status !== "Running") report("booting")
    }
    await start(instance, signal)

    report("connecting")
    await files.write(
      file.conf,
      sshConfigText({
        alias,
        proxyCommand: proxyCommandOf(settings.guestProxy, name),
        user: settings.guestUser,
        identityFile: file.key,
        knownHostsFile: file.knownHosts,
      }),
      0o600,
    )
    await waitForSsh(alias, signal)
    await linkHostRipgrep(alias, signal)
  }

  /**
   * DSH's grep and glob spawn the Host's own ripgrep path in the bot's
   * environment: make that path, in the VM, a link to the VM's ripgrep.
   */
  async function linkHostRipgrep(alias: string, signal?: AbortSignal): Promise<void> {
    const host = await deps.hostRipgrep()
    if (!isCanonicalPath(host)) throw new Error(`DSH's ripgrep path "${host}" is not canonical`)
    if (host === settings.guestRipgrep) return
    const link = shellQuote(host)
    const to = shellQuote(settings.guestRipgrep)
    const command = [
      `test -x ${to} || { echo "${settings.guestRipgrep} is missing in the VM" >&2; exit 3; }`,
      `[ "$(readlink -- ${link})" = ${to} ] && exit 0`,
      `sudo -n install -d -m 0755 -- "$(dirname -- ${link})" && sudo -n ln -sfn -- ${to} ${link}`,
    ].join("; ")
    const result = await deps.run("ssh", sshArgs(alias, command), { signal, timeoutMs: 30_000 })
    if (result.code !== 0) {
      throw new Error(
        `cannot link DSH's ripgrep ${host} to ${settings.guestRipgrep} in ${alias} (exit ${result.code}): ${result.stderr.trim()}`,
      )
    }
  }

  return {
    id: ENVIRONMENT_ID,
    workspace: settings.workspace,
    isolate: ISOLATED_SERVICES,
    ensure(target, options = {}) {
      try {
        checkId(target.id)
      } catch (error) {
        return Promise.reject(error)
      }
      seen.add(target.id)
      busy.set(target.id, (busy.get(target.id) ?? 0) + 1)
      return serial
        .run(target.id, () => ensureOnce(target, options))
        .then(
          () => {
            if (seen.has(target.id)) healthy.add(target.id)
          },
          (error: unknown) => {
            healthy.delete(target.id)
            throw error
          },
        )
        .finally(() => {
          const left = (busy.get(target.id) ?? 1) - 1
          if (left === 0) busy.delete(target.id)
          else busy.set(target.id, left)
        })
    },
    remove(botId) {
      try {
        checkId(botId)
      } catch (error) {
        return Promise.reject(error)
      }
      seen.delete(botId)
      healthy.delete(botId)
      return serial.run(botId, async () => {
        const name = instanceOf(botId)
        const instance = await incus.instance(name)
        if (instance !== undefined && !ours(instance, botId)) {
          deps.log(`not deleting ${name}: it was not created by this installation for bot ${botId}`)
        } else if (instance !== undefined) {
          deps.log(`deleting ${name}`)
          await incus.destroy(name)
        }
        await removeConf(botId)
        // Keys and state only: the shared workspace under hostRoot stays.
        await files.remove(paths(botId).dir)
      })
    },
    rows(bot) {
      return environmentRows({ ...settings, sshConfigDir: sshDir }, bot)
    },
    async openGuest(instance, signal) {
      const name = checkInstanceName(instance)
      const botId = name.slice(settings.instancePrefix.length)
      if (!name.startsWith(settings.instancePrefix) || !BOT_ID.test(botId)) {
        throw new Error(`"${name}" is not a bot VM`)
      }
      const found = await incus.instance(name, signal)
      if (found === undefined || !ours(found, botId)) {
        throw new Error(`"${name}" is not a bot VM of this installation`)
      }
      if (found.status !== "Running") throw new Error(`"${name}" is ${found.status}`)
      return incus.exec(name, { command: SSHD_COMMAND, user: 0, group: 0, environment: {} }, signal)
    },
    async capacity(botId, signal) {
      checkId(botId)
      let pool: string | undefined
      for (const profileName of settings.profiles) {
        const profile = await incus.profile(profileName, signal)
        if (profile === undefined) throw new Error(`Incus profile "${profileName}" does not exist`)
        pool = profile.devices[ROOT_DEVICE]?.pool ?? pool
      }
      if (pool === undefined) {
        throw new Error(
          `no profile of ${settings.profiles.join(", ")} gives a root disk on a storage pool`,
        )
      }
      const [host, project, poolBytes, instances] = await Promise.all([
        incus.hostResources(signal),
        incus.projectConfig(signal),
        incus.poolSpace(pool, signal),
        incus.instances(signal),
      ])
      // Only a project with limits.memory makes the others' memory count; Incus
      // then refuses percentages, so every value there is a size.
      const othersMemoryBytes =
        project[MEMORY_KEY] === undefined
          ? 0
          : instances
              .filter((instance) => instance.name !== instanceOf(botId))
              .reduce((sum, instance) => {
                const bytes = instanceSizesOf(instance).memoryBytes
                if (bytes === undefined) {
                  throw new Error(`cannot read the memory of Incus instance "${instance.name}"`)
                }
                return sum + bytes
              }, 0)
      return capacityOf({
        hostCpus: host.cpus,
        hostMemoryBytes: host.memoryBytes,
        projectMemory: project[MEMORY_KEY],
        othersMemoryBytes,
        poolBytes,
      })
    },
    async inspect(botId, signal) {
      checkId(botId)
      const instance = await incus.instance(instanceOf(botId), signal)
      if (instance === undefined) return undefined
      if (!ours(instance, botId)) {
        throw new Error(
          `Incus instance "${instance.name}" exists but was not created by this installation for bot ${botId}`,
        )
      }
      return specOfInstance(instance)
    },
    onChange(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async poll(signal) {
      if (polling || healthy.size === 0 || listeners.size === 0) return
      polling = true
      try {
        const running = new Set(
          (await incus.instances(signal))
            .filter((instance) => instance.status === "Running")
            .map((instance) => instance.name),
        )
        for (const botId of [...healthy]) {
          if (busy.has(botId) || running.has(instanceOf(botId))) continue
          deps.log(`${instanceOf(botId)} is not running; asking bot-core to ensure it again`)
          for (const listener of [...listeners]) listener(botId)
        }
      } finally {
        polling = false
      }
    },
    async reconcile(keep, signal) {
      const kept = new Set([...keep, ...seen])
      const marked: string[] = []
      const removed: string[] = []
      for (const listed of await incus.instances(signal)) {
        const botId = listed.config[CONFIG_BOT_ID]
        if (botId === undefined || !BOT_ID.test(botId) || !ours(listed, botId)) continue
        // Decided again under the bot's lock: an ensure may have started meanwhile.
        const outcome = await serial.run(botId, async () => {
          const instance = await incus.instance(listed.name, signal)
          if (instance === undefined || !ours(instance, botId)) return undefined
          const mark = instance.config[CONFIG_ORPHANED] ?? ""
          if (kept.has(botId) || seen.has(botId)) {
            if (mark !== "")
              await incus.patchConfig(instance.name, { [CONFIG_ORPHANED]: "" }, signal)
            return undefined
          }
          if (mark === "") {
            deps.log(
              `bot ${botId} no longer exists: stopping ${instance.name} and marking it orphaned`,
            )
            if (instance.status !== "Stopped") await incus.setState(instance.name, "stop", signal)
            await incus.patchConfig(
              instance.name,
              { [CONFIG_ORPHANED]: new Date(deps.now()).toISOString() },
              signal,
            )
            return "marked" as const
          }
          const since = Date.parse(mark)
          if (Number.isNaN(since) || deps.now() - since < settings.orphanGraceMs) return undefined
          deps.log(`deleting ${instance.name}, orphaned since ${mark}`)
          await incus.destroy(instance.name, signal)
          await removeConf(botId)
          await files.remove(paths(botId).dir)
          return "removed" as const
        })
        if (outcome === "marked") marked.push(botId)
        if (outcome === "removed") removed.push(botId)
      }
      return { marked, removed }
    },
  }
}
