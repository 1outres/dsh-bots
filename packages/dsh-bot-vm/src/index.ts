/**
 * `@1outres/dsh-bot-vm` (row `bot-vm`): registers the `incus-vm` bot
 * environment with bot-core. Every bot gets its own Incus VM; bot Agents
 * reach it over SSH (through the VM's vsock) with the rows `rows()` returns.
 *
 * This file is the composition root: it wires the Host modules to Node
 * (HTTP over the Incus Unix socket, files, child processes, timers).
 */
import { execFile } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { access, chmod, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { delimiter, isAbsolute, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Bot } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import {
  type CommandResult,
  createVmEnvironment,
  type EnvironmentFiles,
  type EnvironmentSettings,
  type HostMount,
  type RunCommand,
} from "./host/environment"
import { createIncusClient } from "./host/incus"
import { decideOwner, OWNER_FILE } from "./host/owner"
import { unixSocketTransport } from "./node/unix-socket"

export { unixSocketTransport }

export const name = "bot-vm"
/**
 * The `bot` service of @1outres/dsh-bot-core. Only types come from that
 * package: a value import would bundle bot-core's runtime into this one.
 */
const BOT = "bot"
export const inject = ["bot"]

function botOf(ctx: Context): Bot {
  const bot = ctx.get(BOT) as Bot | undefined
  if (bot === undefined) throw new Error(`the "${BOT}" service is not available; inject it`)
  return bot
}

/** dsh-ssh 0.2.2-rc.5's lib/helper.js, as the base image installs it. */
export const HELPER_SHA256 = "8cf436d3657343765ea0031bcc6e78edb20580fb9c2595fd7bb08b193021f40e"

export interface Config {
  stateDir: string
  hostRoot: string
  guestUid: number
  guestGid: number
  incusSocket: string
  incusProject: string
  image: string
  profiles: string[]
  instancePrefix: string
  hostAliasPrefix: string
  socat: string
  guestRipgrep: string
  guestUser: string
  workspace: string
  guestNode: string
  helper: string
  helperHash: string
  requestTimeoutMs: number
  readyTimeoutMs: number
  operationTimeoutMs: number
  incusTimeoutMs: number
  maxConcurrentProvisions: number
  watchIntervalMs: number
  reconcileDelayMs: number
  reconcileIntervalMs: number
  orphanGraceMs: number
  owner: string
}

export const Config: z<Config> = z.object({
  stateDir: z
    .string()
    .default("~/.dsh/bots-vm")
    .description(
      "Keys, known_hosts and state per bot; ssh/<bot>.conf under it must be included by ~/.ssh/config. A leading ~ is your home.",
    ),
  hostRoot: z
    .string()
    .default("~/.dsh/bots")
    .description(
      "Host directory of the bots' workspaces: a bot's /home/bot/workspace is <hostRoot>/<bot id>/workspace, shared into its VM (virtiofs). Must be mounted nosuid,nodev (infra/vm/host-setup.sh). Deleting a bot keeps it. A leading ~ is your home.",
    ),
  guestUid: z
    .number()
    .default(1001)
    .description("The guest user's uid in the image; it maps to the DSH user in the share."),
  guestGid: z.number().default(1001).description("The guest user's gid in the image."),
  incusSocket: z.string().default("/var/lib/incus/unix.socket").description("Incus API socket."),
  incusProject: z.string().default("default").description("Incus project of the bot VMs."),
  image: z.string().default("dsh-bot-base").description("Incus image alias bot VMs start from."),
  profiles: z
    .array(z.string())
    .default(["dsh-bot"])
    .description("Incus profiles of a bot VM (network, limits, storage)."),
  instancePrefix: z.string().default("dsh-bot-").description("Instance name is <prefix><bot id>."),
  hostAliasPrefix: z
    .string()
    .default("dsh-bot-")
    .description("SSH host alias is <prefix><bot id>."),
  socat: z
    .string()
    .default("socat")
    .description(
      "socat (1.7.4 or newer) relays SSH to the VM's vsock: a command the PATH of DSH resolves, or an absolute path.",
    ),
  guestRipgrep: z
    .string()
    .default("/usr/bin/rg")
    .description(
      "ripgrep inside the VM; DSH's own ripgrep path is linked to it there, since DSH's grep and glob spawn that path.",
    ),
  guestUser: z.string().default("bot").description("Guest user SSH logs in as."),
  workspace: z
    .string()
    .default("/home/bot/workspace")
    .description(
      "Guest directory that is the cwd of every bot session (the same in every bot VM; the base image provides the default).",
    ),
  guestNode: z.string().default("/usr/bin/node").description("Guest Node executable."),
  helper: z
    .string()
    .default("/opt/dsh-ssh-helper/node_modules/@deepseek-ai/dsh-ssh/lib/helper.js")
    .description("Guest path of dsh-ssh's helper.js."),
  helperHash: z.string().default(HELPER_SHA256).description("SHA-256 of that helper.js."),
  requestTimeoutMs: z.number().default(30_000).description("dsh-ssh connect and request deadline."),
  readyTimeoutMs: z
    .number()
    .default(480_000)
    .description(
      "How long ensure waits for a VM to answer over SSH (a VM's first boot from a new image can take minutes).",
    ),
  operationTimeoutMs: z
    .number()
    .default(300_000)
    .description("Deadline of one Incus operation (create, start, delete)."),
  incusTimeoutMs: z
    .number()
    .default(30_000)
    .description("Deadline of one request to the Incus API (an operation wait adds its own time)."),
  maxConcurrentProvisions: z
    .number()
    .default(2)
    .description(
      "How many bot VMs may be created or booted at once (every bot is ensured at start-up).",
    ),
  watchIntervalMs: z
    .number()
    .default(60_000)
    .description(
      "How often to check that the bots' VMs run; a stopped one is started again. 0 turns it off.",
    ),
  reconcileDelayMs: z
    .number()
    .default(60_000)
    .description(
      "After start, wait this long before the first clean-up of VMs whose bot no longer exists. 0 turns clean-up off.",
    ),
  reconcileIntervalMs: z
    .number()
    .default(3_600_000)
    .description("Clean-up interval after the first one."),
  orphanGraceMs: z
    .number()
    .default(7 * 24 * 3_600_000)
    .description(
      "A VM whose bot no longer exists is stopped and marked first, and deleted (with its keys) only after this long.",
    ),
  owner: z
    .string()
    .default("")
    .description(
      "Marks the Incus instances this installation creates; others are never touched. Empty: the id stored in <stateDir>/owner, created once.",
    ),
}) as z<Config>

/** The tag of earlier versions: a hash of the state directory's real path. */
export function earlierOwnerOf(stateDir: string): string {
  return createHash("sha256").update(realpathSync(stateDir)).digest("hex").slice(0, 16)
}

/** This installation's owner tag, stored once in `<stateDir>/owner` (src/host/owner.ts). */
export function ownerOf(stateDir: string): string {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  const file = join(stateDir, OWNER_FILE)
  const decision = decideOwner({
    stored: existsSync(file) ? readFileSync(file, "utf8") : undefined,
    hasEarlierState: existsSync(join(stateDir, "bots")),
    earlierOwner: () => earlierOwnerOf(stateDir),
    random: () => randomBytes(16).toString("hex"),
  })
  if (decision.kind === "create") {
    writeFileSync(file, `${decision.owner}\n`, { mode: 0o600, flag: "wx" })
  }
  return decision.owner
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? resolve(homedir(), `.${path.slice(1)}`) : path
}

export const nodeFiles: EnvironmentFiles = {
  async read(path) {
    try {
      return await readFile(path, "utf8")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
      throw error
    }
  },
  async write(path, content, mode) {
    const temporary = `${path}.${process.pid}.tmp`
    await writeFile(temporary, content, { mode })
    await chmod(temporary, mode)
    await rename(temporary, path)
  },
  async mkdir(path, mode) {
    await mkdir(path, { recursive: true, mode })
    await chmod(path, mode)
  },
  async remove(path) {
    await rm(path, { recursive: true, force: true })
  },
}

/** `\040`-style escapes of /proc/self/mountinfo. */
function unescapeMountField(field: string): string {
  return field.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8)),
  )
}

/** The mount an existing path lies on, from /proc/self/mountinfo (the last mount of the longest matching point). */
export function mountFromInfo(info: string, path: string): HostMount {
  let best: HostMount | undefined
  for (const line of info.split("\n")) {
    const fields = line.split(" ")
    if (fields.length < 6) continue
    const target = unescapeMountField(fields[4] as string)
    const inside = target === "/" || path === target || path.startsWith(`${target}/`)
    if (!inside) continue
    // Later lines are mounted on top: a later mount of the same point wins.
    if (best === undefined || target.length >= best.target.length) {
      best = { target, options: (fields[5] as string).split(",") }
    }
  }
  if (best === undefined) throw new Error(`no mount found for ${path}`)
  return best
}

export async function hostMountOf(path: string): Promise<HostMount> {
  return mountFromInfo(await readFile("/proc/self/mountinfo", "utf8"), await realpath(path))
}

export const runCommand: RunCommand = (file, args, options) =>
  new Promise<CommandResult>((resolvePromise, reject) => {
    execFile(
      file,
      [...args],
      { signal: options?.signal, timeout: options?.timeoutMs ?? 0, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== "number") {
          // Spawn failure, abort or timeout: no exit code to report.
          if (error.name === "AbortError") return reject(error)
          if (error.killed) return resolvePromise({ code: 255, stdout, stderr: "timed out" })
          return reject(error)
        }
        resolvePromise({ code: error === null ? 0 : Number(error.code), stdout, stderr })
      },
    )
  })

/** A command's absolute path: itself when absolute, else the first executable on PATH. */
export async function which(command: string): Promise<string> {
  const executable = async (path: string) =>
    access(path, 1).then(
      () => true,
      () => false,
    )
  if (isAbsolute(command)) {
    if (await executable(command)) return command
    throw new Error(`${command} is not an executable file`)
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (directory === "" || !isAbsolute(directory)) continue
    const path = join(directory, command)
    if (await executable(path)) return path
  }
  throw new Error(
    `${command} is not on the PATH of DSH (${process.env.PATH ?? ""}); install it or configure its absolute path`,
  )
}

/** The ripgrep DSH's grep and glob spawn (@deepseek-ai/dsh-util-ripgrep, from the Host's DSH). */
async function hostRipgrep(): Promise<string> {
  const { resolveRgPath } = await import("@deepseek-ai/dsh-util-ripgrep")
  return resolveRgPath()
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    signal?.throwIfAborted()
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted)
      resolvePromise()
    }, ms)
    const aborted = () => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener("abort", aborted, { once: true })
  })
}

/** Environment settings from the plugin config, paths expanded. */
export function settingsOf(config: Config, owner: string): EnvironmentSettings {
  const stateDir = expandHome(config.stateDir)
  return {
    hostRoot: expandHome(config.hostRoot),
    hostUid: process.getuid?.() ?? -1,
    hostGid: process.getgid?.() ?? -1,
    guestUid: config.guestUid,
    guestGid: config.guestGid,
    stateDir,
    owner,
    orphanGraceMs: config.orphanGraceMs,
    instancePrefix: config.instancePrefix,
    hostAliasPrefix: config.hostAliasPrefix,
    image: config.image,
    profiles: config.profiles,
    guestUser: config.guestUser,
    workspace: config.workspace,
    vsockProxy: {
      node: process.execPath,
      script: fileURLToPath(new URL("./vsock-proxy.js", import.meta.url)),
      socket: config.incusSocket,
      project: config.incusProject,
    },
    socat: config.socat,
    guestRipgrep: config.guestRipgrep,
    guestNode: config.guestNode,
    helper: config.helper,
    helperHash: config.helperHash,
    requestTimeoutMs: config.requestTimeoutMs,
    readyTimeoutMs: config.readyTimeoutMs,
    probeIntervalMs: 2_000,
    maxConcurrentProvisions: config.maxConcurrentProvisions,
  }
}

export function apply(ctx: Context, config: Config): void {
  const stateDir = expandHome(config.stateDir)
  const settings = settingsOf(config, config.owner === "" ? ownerOf(stateDir) : config.owner)
  const environment = createVmEnvironment(settings, {
    incus: createIncusClient({
      transport: unixSocketTransport(config.incusSocket),
      project: config.incusProject,
      operationTimeoutMs: config.operationTimeoutMs,
      requestTimeoutMs: config.incusTimeoutMs,
    }),
    which,
    hostRipgrep,
    files: nodeFiles,
    mountOf: hostMountOf,
    run: runCommand,
    sleep,
    now: Date.now,
    log: (message) => ctx.logger.info(message),
  })
  const bot = botOf(ctx)
  ctx.effect(() => bot.registerEnvironment(environment), "bot-vm: environment")

  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), "bot-vm: upkeep")
  const warn = (what: string) => (error: unknown) => {
    if (!lifetime.signal.aborted) ctx.logger.warn(`bot-vm: ${what}: ${String(error)}`)
  }
  // bot-core ensures every stored bot as soon as the environment registers
  // (each is then kept); botIds() adds the stored ones, including bots being
  // created or whose creation failed. Only after the delay is anything else
  // of ours taken for a bot deleted meanwhile.
  if (config.reconcileDelayMs > 0) {
    let running = false
    const reconcile = () => {
      if (running || lifetime.signal.aborted) return
      running = true
      void environment
        .reconcile(bot.botIds(), lifetime.signal)
        .then(({ marked, removed }) => {
          if (marked.length > 0)
            ctx.logger.info(`bot-vm: stopped VMs of deleted bots ${marked.join(", ")}`)
          if (removed.length > 0)
            ctx.logger.info(`bot-vm: deleted VMs of deleted bots ${removed.join(", ")}`)
        })
        .catch(warn("cleaning up deleted bots failed"))
        .finally(() => {
          running = false
        })
    }
    let every: ReturnType<typeof setInterval> | undefined
    const first = setTimeout(() => {
      reconcile()
      if (config.reconcileIntervalMs > 0) {
        every = setInterval(reconcile, config.reconcileIntervalMs)
        every.unref()
      }
    }, config.reconcileDelayMs)
    first.unref()
    ctx.effect(
      () => () => {
        clearTimeout(first)
        clearInterval(every)
      },
      "bot-vm: clean-up",
    )
  }
  if (config.watchIntervalMs > 0) {
    const timer = setInterval(() => {
      void environment.poll(lifetime.signal).catch(warn("checking the bot VMs failed"))
    }, config.watchIntervalMs)
    timer.unref()
    ctx.effect(() => () => clearInterval(timer), "bot-vm: watch")
  }
}
