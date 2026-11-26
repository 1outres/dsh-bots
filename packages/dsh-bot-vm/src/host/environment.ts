import type {
  BotEnvironment,
  BotEnvironmentCapacity,
  BotEnvironmentTarget,
  EnsureOptions,
  EnvironmentPhase,
} from "@1outres/dsh-bot-core"
import { capacityOf } from "./capacity"
import { BOOT_FINISHED, isCanonicalPath, userDataText } from "./cloud-init"
import { type EgressReport, egressProbeScript, egressReportOf } from "./egress-probe"
import { checkEndpoint, type ProjectDeclaration } from "./endpoint-check"
import { checkInstanceName, type GuestProxy, proxyCommandOf, SSHD_COMMAND } from "./guest-transport"
import type { ImageGate } from "./image/manager"
import type { ExecSession, IncusClient, IncusInstance, IncusVolume } from "./incus"
import { layoutOf, WORKSPACE_BY_ID } from "./layout"
import { createLimiter } from "./limit"
import { type Reconfiguration, reconfigure } from "./reconfigure"
import { environmentRows, hostAliasOf, ISOLATED_SERVICES, type RowSettings } from "./rows"
import { createSerializer } from "./serial"
import { CPU_KEY, instanceSizesOf, MEMORY_KEY, SIZE_KEY, specOf } from "./spec"
import { knownHostsText, MANAGED_HEADER, shellQuote, sshConfigText } from "./ssh-config"
import { type VolumePlan, volumeNameOf, volumePlan } from "./workspace-volume"

export const ENVIRONMENT_ID = "incus-vm"

export const sshConfigDirOf = (stateDir: string) => `${stateDir}/ssh`

export interface EnvironmentFiles {
  read(path: string): Promise<string | undefined>
  write(path: string, content: string, mode: number): Promise<void>
  mkdir(path: string, mode: number): Promise<void>
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

export interface EnvironmentDeps {
  readonly incus: IncusClient
  readonly image: ImageGate
  readonly scope: () => Promise<{ readonly kind: "local" | "remote"; readonly project: string }>
  readonly egress: (botId: string, report: EgressReport) => void
  readonly hostRipgrep: () => Promise<string>
  readonly files: EnvironmentFiles
  readonly run: RunCommand
  readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  readonly now: () => number
  readonly log: (message: string) => void
}

export interface EnvironmentSettings extends RowSettings {
  readonly stateDir: string
  readonly owner: string
  readonly orphanGraceMs: number
  readonly instancePrefix: string
  readonly image: string
  readonly rootDiskGiB: number
  readonly guestUser: string
  readonly guestProxy: GuestProxy
  readonly guestRipgrep: string
  readonly readyTimeoutMs: number
  readonly probeIntervalMs: number
  readonly maxConcurrentProvisions: number
}

interface BotState {
  readonly version: 1
}

const BOT_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/
const INSTANCE_PREFIX = /^[a-zA-Z][a-zA-Z0-9-]*$/
const ALIAS_PREFIX = /^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/
const MAX_INSTANCE_NAME = 63
const WARM_UP_MIN_MS = 120_000
const WARM_UP_LOG_MS = 5_000
const EGRESS_PROBE_TIMEOUT_MS = 30_000
const SSH_FAILURE = 255

export interface VmEnvironment extends BotEnvironment {
  capacity(botId: string, signal?: AbortSignal): Promise<BotEnvironmentCapacity>
  onChange(listener: (botId: string) => void): () => void
  poll(signal?: AbortSignal): Promise<void>
  reconcile(keep: Iterable<string>, signal?: AbortSignal): Promise<ReconcileResult>
  openGuest(instance: string, signal?: AbortSignal): Promise<ExecSession>
  rehome(): void
}

export interface ReconcileResult {
  readonly marked: readonly string[]
  readonly removed: readonly string[]
}

export const CONFIG_BOT_ID = "user.dsh-bot.id"
export const CONFIG_OWNER = "user.dsh-bot.owner"
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
  if (!Number.isSafeInteger(settings.rootDiskGiB) || settings.rootDiskGiB < 1) {
    throw new Error(
      `rootDiskGiB must be a positive whole number of GiB, not ${settings.rootDiskGiB}`,
    )
  }
  const serial = createSerializer()
  const provisions = createLimiter(settings.maxConcurrentProvisions)
  const seen = new Set<string>()
  const healthy = new Set<string>()
  let polling = false
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
  const volumeOf = (botId: string) => volumeNameOf(instanceOf(botId))
  const tags = (botId: string) => ({ [CONFIG_BOT_ID]: botId, [CONFIG_OWNER]: settings.owner })

  async function placement(
    signal?: AbortSignal,
  ): Promise<ProjectDeclaration & { readonly project: string }> {
    const { kind, project } = await deps.scope()
    const check = await checkEndpoint({ incus, kind, project }, signal)
    if (check.ok) return { ...check.declaration, project }
    throw new Error(
      `the Incus project "${project}" cannot hold bot VMs: ${check.problems.map((problem) => `${problem.message} (${problem.fix})`).join("; ")}`,
    )
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

  async function waitForSsh(alias: string, signal?: AbortSignal): Promise<void> {
    const workspace = shellQuote(settings.workspace)
    const deadline = deps.now() + settings.readyTimeoutMs
    let last = ""
    for (;;) {
      signal?.throwIfAborted()
      const result = await deps.run(
        "ssh",
        sshArgs(
          alias,
          `test -e ${BOOT_FINISHED} && mountpoint -q ${workspace} && test -w ${workspace}`,
        ),
        { signal, timeoutMs: 30_000 },
      )
      if (result.code === 0) return warmUp(alias, deadline, signal)
      last =
        result.code === SSH_FAILURE
          ? `did not answer over SSH: ${result.stderr.trim()}`
          : `answers over SSH but cloud-init has not finished, or ${settings.workspace} is not the mounted workspace volume ${settings.guestUser} can write (exit ${result.code})`
      if (deps.now() >= deadline) {
        throw new Error(
          `the bot VM (${alias}) is not ready within ${settings.readyTimeoutMs} ms: it ${last}`,
        )
      }
      await deps.sleep(settings.probeIntervalMs, signal)
    }
  }

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

  const tagged = (config: Readonly<Record<string, string>>, botId: string) =>
    config[CONFIG_BOT_ID] === botId && config[CONFIG_OWNER] === settings.owner
  const ours = (instance: IncusInstance, botId: string) =>
    instance.name === instanceOf(botId) && tagged(instance.config, botId)
  const oursVolume = (volume: IncusVolume, botId: string) =>
    volume.name === volumeOf(botId) && tagged(volume.config, botId)
  const orphanedSince = (config: Readonly<Record<string, string>>) => config[CONFIG_ORPHANED] ?? ""

  async function removeConf(botId: string): Promise<void> {
    const conf = paths(botId).conf
    const text = await files.read(conf)
    if (text?.startsWith(`${MANAGED_HEADER}\n`)) await files.remove(conf)
  }

  async function forgetFiles(botId: string): Promise<void> {
    await removeConf(botId)
    await files.remove(paths(botId).dir)
  }

  async function markVolume(pool: string, botId: string, signal?: AbortSignal): Promise<void> {
    const volume = await incus.volume(pool, volumeOf(botId), signal)
    if (volume === undefined || !oursVolume(volume, botId) || orphanedSince(volume.config) !== "")
      return
    await incus.patchVolume(
      pool,
      volume.name,
      { [CONFIG_ORPHANED]: new Date(deps.now()).toISOString() },
      signal,
    )
  }

  async function ensureOnce(target: BotEnvironmentTarget, options: EnsureOptions): Promise<void> {
    const { signal } = options
    const report = (phase: EnvironmentPhase) => options.progress?.(phase)
    const botId = target.id
    const name = instanceOf(botId)
    const alias = hostAliasOf(settings, botId)
    const file = paths(botId)
    const where = await placement(signal)
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
        `Incus instance "${name}" exists but its state under ${file.dir} is missing; delete it (incus delete --force ${name} --project ${where.project}) to provision it again`,
      )
    }
    const volume = await incus.volume(where.pool, volumeOf(botId), signal)
    const volumeChange = volumePlan(volume, target.spec.diskGiB, (found) =>
      oursVolume(found, botId),
    )
    if (volume !== undefined && orphanedSince(volume.config) !== "") {
      deps.log(`${volume.name} belongs to an existing bot again; clearing its orphan mark`)
      await incus.patchVolume(where.pool, volume.name, { [CONFIG_ORPHANED]: "" }, signal)
    }

    const fresh = instance === undefined
    const client = await keyPair(file.key, alias, fresh, signal)
    const host = await keyPair(file.hostKey, `${alias} host key`, fresh, signal)
    await files.write(file.knownHosts, knownHostsText(alias, host.publicKey), 0o600)

    const layout = layoutOf({
      spec: target.spec,
      placement: where,
      volume: volumeOf(botId),
      rootDiskGiB: settings.rootDiskGiB,
    })
    const existing =
      instance === undefined ? undefined : { instance, plan: reconfigure(instance, layout) }
    const stopsForVolume =
      volumeChange.kind === "grow" && instance !== undefined && instance.status !== "Stopped"
    const needsBoot =
      existing === undefined ||
      existing.instance.status !== "Running" ||
      existing.plan.stop ||
      stopsForVolume
    const bring = () =>
      bringUp(
        { target, pool: where.pool, layout, existing, volumeChange, keys: { client, host } },
        report,
        signal,
      )
    let imported = false
    if (existing === undefined) {
      await deps.image.ready(signal, () => {
        imported = true
        report("image")
      })
    }
    if (needsBoot) {
      if (!imported) report("queued")
      await provisions.run(bring, signal)
    } else await bring()
  }

  async function applyVolume(
    pool: string,
    botId: string,
    change: VolumePlan,
    diskGiB: number,
    signal?: AbortSignal,
  ): Promise<void> {
    if (change.kind === "create") {
      deps.log(`creating the workspace volume ${volumeOf(botId)} (${diskGiB}GiB)`)
      await incus.createVolume(
        {
          pool,
          name: volumeOf(botId),
          contentType: "block",
          description: `dsh bot ${botId} workspace`,
          config: { [SIZE_KEY]: `${diskGiB}GiB`, ...tags(botId) },
        },
        signal,
      )
    } else if (change.kind === "grow") {
      deps.log(`growing the workspace volume ${volumeOf(botId)} to ${change.size}`)
      await incus.patchVolume(pool, volumeOf(botId), { [SIZE_KEY]: change.size }, signal)
    }
  }

  async function reconfigureInstance(
    instance: IncusInstance,
    plan: Reconfiguration,
    volume: {
      readonly pool: string
      readonly botId: string
      readonly change: VolumePlan
      readonly diskGiB: number
    },
    signal?: AbortSignal,
  ): Promise<IncusInstance> {
    const { name } = instance
    const { change } = plan
    const grows = volume.change.kind === "grow"
    if (change === undefined && !grows) return instance
    const stop = plan.stop || (grows && instance.status !== "Stopped")
    const what = [
      ...[CPU_KEY, MEMORY_KEY].flatMap((key) =>
        change?.config?.[key] === undefined ? [] : [`${key} ${change.config[key]}`],
      ),
      ...Object.keys(change?.devices ?? {}).map((device) => `device ${device}`),
      ...(grows ? [`workspace ${volume.diskGiB}GiB`] : []),
    ]
    deps.log(`${name}: ${what.join(", ") || "own config"}${stop ? " (restarts the VM)" : ""}`)
    if (stop) await incus.setState(name, "stop", signal)
    try {
      if (change !== undefined) await incus.update(name, change, signal)
      await applyVolume(volume.pool, volume.botId, volume.change, volume.diskGiB, signal)
    } catch (error) {
      if (stop) await incus.setState(name, "start")
      throw error
    }
    const updated = await incus.instance(name, signal)
    if (updated === undefined) throw new Error(`Incus instance "${name}" disappeared`)
    return updated
  }

  interface BringUp {
    readonly target: BotEnvironmentTarget
    readonly pool: string
    readonly layout: ReturnType<typeof layoutOf>
    readonly existing:
      | { readonly instance: IncusInstance; readonly plan: Reconfiguration }
      | undefined
    readonly volumeChange: VolumePlan
    readonly keys: {
      client: { publicKey: string }
      host: { privateKey: string; publicKey: string }
    }
  }

  async function bringUp(
    work: BringUp,
    report: (phase: EnvironmentPhase) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const { target, pool, layout, existing, volumeChange, keys } = work
    const botId = target.id
    const name = instanceOf(botId)
    const alias = hostAliasOf(settings, botId)
    const file = paths(botId)
    let instance: IncusInstance | undefined
    if (existing === undefined) {
      await writeState(file.state, { version: 1 })
      report("creating")
      await applyVolume(pool, botId, volumeChange, target.spec.diskGiB, signal)
      deps.log(`creating ${name} for bot ${target.id} (${target.name})`)
      await incus.create(
        {
          name,
          description: `dsh bot ${target.id}`,
          image: settings.image,
          profiles: [],
          config: {
            ...layout.config,
            "cloud-init.user-data": userDataText({
              workspaceDevice: WORKSPACE_BY_ID,
              user: settings.guestUser,
              workspace: settings.workspace,
              authorizedKey: keys.client.publicKey,
              hostPrivateKey: keys.host.privateKey,
              hostPublicKey: keys.host.publicKey,
            }),
            ...tags(botId),
          },
          devices: layout.devices,
          start: false,
        },
        signal,
      )
      instance = await incus.instance(name, signal)
      if (instance === undefined) throw new Error(`Incus did not create "${name}"`)
      report("booting")
    } else {
      if (orphanedSince(existing.instance.config) !== "") {
        deps.log(`${name} belongs to an existing bot again; clearing its orphan mark`)
        await incus.patchConfig(name, { [CONFIG_ORPHANED]: "" }, signal)
      }
      instance = await reconfigureInstance(
        existing.instance,
        existing.plan,
        { pool, botId, change: volumeChange, diskGiB: target.spec.diskGiB },
        signal,
      )
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
    await measureEgress(botId, alias, signal)
  }

  async function measureEgress(botId: string, alias: string, signal?: AbortSignal): Promise<void> {
    const result = await deps.run("ssh", sshArgs(alias, egressProbeScript()), {
      signal,
      timeoutMs: EGRESS_PROBE_TIMEOUT_MS,
    })
    signal?.throwIfAborted()
    const report =
      result.code === 0
        ? egressReportOf(result.stdout, deps.now())
        : {
            state: "unmeasured" as const,
            at: deps.now(),
            reason: `the probe failed (exit ${result.code}): ${result.stderr.trim()}`,
          }
    if (report.state === "open") {
      deps.log(
        `${alias} reaches ${report.reached.join(", ")}; the VM host's egress ACL lets that through`,
      )
    } else if (report.state === "unmeasured") {
      deps.log(`measuring the egress of ${alias} failed: ${report.reason}`)
    }
    deps.egress(botId, report)
  }

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

  async function retire(botId: string, signal?: AbortSignal): Promise<void> {
    const name = instanceOf(botId)
    const instance = await incus.instance(name, signal)
    if (instance !== undefined && !ours(instance, botId)) {
      deps.log(`not deleting ${name}: it was not created by this installation for bot ${botId}`)
    } else if (instance !== undefined) {
      deps.log(`deleting ${name}`)
      await incus.destroy(name, signal)
    }
    await forgetFiles(botId)
  }

  async function reconcileVolumes(
    pool: string,
    kept: ReadonlySet<string>,
    signal: AbortSignal | undefined,
    outcome: { marked: Set<string>; removed: Set<string> },
  ): Promise<void> {
    for (const listed of await incus.volumes(pool, signal)) {
      const botId = listed.config[CONFIG_BOT_ID]
      if (botId === undefined || !BOT_ID.test(botId) || !oursVolume(listed, botId)) continue
      await serial.run(botId, async () => {
        const volume = await incus.volume(pool, listed.name, signal)
        if (volume === undefined || !oursVolume(volume, botId)) return
        const mark = orphanedSince(volume.config)
        if (kept.has(botId) || seen.has(botId)) {
          if (mark !== "")
            await incus.patchVolume(pool, volume.name, { [CONFIG_ORPHANED]: "" }, signal)
          return
        }
        if (mark === "") {
          deps.log(`bot ${botId} no longer exists: marking ${volume.name} orphaned`)
          await markVolume(pool, botId, signal)
          outcome.marked.add(botId)
          return
        }
        const since = Date.parse(mark)
        if (Number.isNaN(since) || deps.now() - since < settings.orphanGraceMs) return
        if (volume.usedBy.length > 0) return
        deps.log(`deleting ${volume.name}, orphaned since ${mark}`)
        await incus.deleteVolume(pool, volume.name, signal)
        outcome.removed.add(botId)
      })
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
        const { pool } = await placement()
        await retire(botId)
        await markVolume(pool, botId)
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
      const { pool } = await placement(signal)
      const [host, project, poolBytes, instances] = await Promise.all([
        incus.hostResources(signal),
        incus.projectConfig(signal),
        incus.poolSpace(pool, signal),
        incus.instances(signal),
      ])
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
        project,
        othersMemoryBytes,
        pool,
        poolBytes,
        rootDiskGiB: settings.rootDiskGiB,
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
      const { pool } = await placement(signal)
      const volume = await incus.volume(pool, volumeOf(botId), signal)
      if (volume === undefined || !oursVolume(volume, botId)) {
        throw new Error(`the workspace volume of Incus instance "${instance.name}" is missing`)
      }
      return specOf(instance, volume)
    },
    rehome() {
      healthy.clear()
      for (const botId of [...seen]) {
        for (const listener of [...listeners]) listener(botId)
      }
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
      const outcome = { marked: new Set<string>(), removed: new Set<string>() }
      const { pool } = await placement(signal)
      for (const listed of await incus.instances(signal)) {
        const botId = listed.config[CONFIG_BOT_ID]
        if (botId === undefined || !BOT_ID.test(botId) || !ours(listed, botId)) continue
        await serial.run(botId, async () => {
          const instance = await incus.instance(listed.name, signal)
          if (instance === undefined || !ours(instance, botId)) return
          const mark = orphanedSince(instance.config)
          if (kept.has(botId) || seen.has(botId)) {
            if (mark !== "")
              await incus.patchConfig(instance.name, { [CONFIG_ORPHANED]: "" }, signal)
            return
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
            outcome.marked.add(botId)
            return
          }
          const since = Date.parse(mark)
          if (Number.isNaN(since) || deps.now() - since < settings.orphanGraceMs) return
          deps.log(`deleting ${instance.name}, orphaned since ${mark}`)
          await retire(botId, signal)
          outcome.removed.add(botId)
        })
      }
      await reconcileVolumes(pool, kept, signal, outcome)
      return { marked: [...outcome.marked], removed: [...outcome.removed] }
    },
  }
}
