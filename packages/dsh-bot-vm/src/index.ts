import { execFile } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { homedir, hostname } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Bot, VmBackendKind } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import type { ImageBackend } from "./host/backend/contract"
import { createIncusBackend } from "./host/backend/incus/backend"
import { createIncusClient } from "./host/backend/incus/client"
import { type IncusEndpoint, parseProjectName } from "./host/backend/incus/endpoint"
import { type PairingDeps, pair } from "./host/backend/incus/pairing"
import { createProxmoxBackend, proxmoxPlace } from "./host/backend/proxmox/backend"
import { createProxmoxClient } from "./host/backend/proxmox/client"
import type { ProxmoxEndpoint } from "./host/backend/proxmox/endpoint"
import {
  type CommandResult,
  createVmEnvironment,
  type EnvironmentFiles,
  type EnvironmentSettings,
  type RunCommand,
} from "./host/environment"
import { createImporter } from "./host/image/importer"
import { createImageManager, type ImageManager } from "./host/image/manager"
import { releaseOf } from "./host/image/release"
import { DSH_VERSION } from "./host/image/release-env"
import { decideOwner, OWNER_FILE } from "./host/owner"
import type { StoredPlacement, StoredProxmox, StoredSetup } from "./host/placement/placement"
import { type BackendConnection, createPlacementScope } from "./host/placement/scope"
import {
  clientKeyRecord,
  proxmoxTokenRecord,
  recordSecretStore,
  type SecretRecords,
  type SecretStore,
} from "./host/placement/secrets"
import { filePlacementStore, type StoreFiles } from "./host/placement/store"
import { readHostSetupBundle } from "./host/setup/bundle"
import { createVmHostSetup } from "./host/setup/setup"
import type { HostSetupBundle } from "./host/setup/shell"
import { createSetupSsh } from "./host/setup/ssh"
import { setupSshPaths } from "./host/setup/ssh-files"
import { fileSetupJobStore } from "./host/setup/store"
import { createVmHost, type VmHost } from "./host/vm-host"
import { certificateFingerprint, createSelfSignedIdentity } from "./node/client-identity"
import { startGuestRelay } from "./node/guest-relay"
import { nodeImageFiles, nodeImageHttp, sha256 } from "./node/image-io"
import { unpackImage } from "./node/image-unpack"
import { createIncusTransport } from "./node/incus-transport"
import { createProxmoxTransport, probeProxmox } from "./node/proxmox-transport"
import { tcpReachable } from "./node/reachable"
import { nodeSetupFiles } from "./node/setup-files"
import { localShell, sshShell } from "./node/setup-shell"
import { SSH_CONNECTION_DEFAULTS } from "./node/ssh/connection"
import { generateSetupKey, pinnedHostKey, scanHostKeys } from "./node/ssh-tools"
import { tcpGuest, tcpReach } from "./node/tcp-guest"

export const name = "bot-vm"
const BOT = "bot"
export const inject = ["bot"]

function botOf(ctx: Context): Bot {
  const bot = ctx.get(BOT) as Bot | undefined
  if (bot === undefined) throw new Error(`the "${BOT}" service is not available; inject it`)
  return bot
}

export const HELPER_SHA256 = "8cf436d3657343765ea0031bcc6e78edb20580fb9c2595fd7bb08b193021f40e"

export interface Config {
  stateDir: string
  incusProject: string
  setupHttpsPort: number
  image: string
  manageImage: boolean
  imageBaseUrl: string
  imageManifestSha256: string
  imageUploadTimeoutMs: number
  rootDiskGiB: number
  instancePrefix: string
  hostAliasPrefix: string
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
      "Keys, known_hosts, each bot's ssh config (ssh/<bot>.conf) and the SSH relay's socket (run/guest.sock). A leading ~ is your home.",
    ),
  incusProject: z
    .string()
    .default("dsh-bots")
    .description(
      'The Incus project a VM host built by dsh-bots gets unless another is chosen (docs/specs/incus-endpoint.md §3.4); "default" is refused.',
    ),
  setupHttpsPort: z
    .number()
    .default(8443)
    .description("The HTTPS port a VM host built by dsh-bots gets unless another is chosen."),
  image: z.string().default("dsh-bot-base").description("Incus image alias bot VMs start from."),
  manageImage: z
    .boolean()
    .default(true)
    .description(
      "Import the base image this version names (infra/release.env) into the project and point the alias at it. Off: the alias is used as it is (an image you built).",
    ),
  imageBaseUrl: z
    .string()
    .default("")
    .description(
      "Where manifest.txt and the image parts are, set together with imageManifestSha256. Empty: the GitHub release this version names.",
    ),
  imageManifestSha256: z
    .string()
    .default("")
    .description("sha256 of the manifest.txt under imageBaseUrl."),
  imageUploadTimeoutMs: z
    .number()
    .default(3_600_000)
    .description("Deadline of sending the base image to the VM host."),
  rootDiskGiB: z
    .number()
    .default(16)
    .description(
      "Root disk of every bot VM in GiB (the system and what the bot installs with apt or npm; its files are on the workspace volume). It only grows.",
    ),
  instancePrefix: z.string().default("dsh-bot-").description("Instance name is <prefix><bot id>."),
  hostAliasPrefix: z
    .string()
    .default("dsh-bot-")
    .description("SSH host alias is <prefix><bot id>."),
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
  requestTimeoutMs: z
    .number()
    .default(SSH_CONNECTION_DEFAULTS.requestTimeoutMs)
    .description("dsh-ssh connect and request deadline."),
  readyTimeoutMs: z
    .number()
    .default(1_200_000)
    .description(
      "How long ensure waits for a VM to answer over SSH (a VM's first boot from a new image can take minutes).",
    ),
  operationTimeoutMs: z
    .number()
    .default(900_000)
    .description("Deadline of one Incus operation or Proxmox task (create, start, delete)."),
  incusTimeoutMs: z
    .number()
    .default(30_000)
    .description(
      "Deadline of one request to the Incus or Proxmox API (an operation wait adds its own time).",
    ),
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

export function earlierOwnerOf(stateDir: string): string {
  return createHash("sha256").update(realpathSync(stateDir)).digest("hex").slice(0, 16)
}

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

export const nodeFiles: EnvironmentFiles & StoreFiles = {
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
  async rename(from, to) {
    await rename(from, to)
  },
}

export const runCommand: RunCommand = (file, args, options) =>
  new Promise<CommandResult>((resolvePromise, reject) => {
    execFile(
      file,
      [...args],
      { signal: options?.signal, timeout: options?.timeoutMs ?? 0, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null && typeof error.code !== "number") {
          if (error.name === "AbortError") return reject(error)
          if (error.killed) return resolvePromise({ code: 255, stdout, stderr: "timed out" })
          return reject(error)
        }
        resolvePromise({ code: error === null ? 0 : Number(error.code), stdout, stderr })
      },
    )
  })

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

export const guestRelaySocketOf = (stateDir: string) => join(stateDir, "run", "guest.sock")

export function settingsOf(config: Config, owner: string): EnvironmentSettings {
  const stateDir = expandHome(config.stateDir)
  return {
    stateDir,
    rootDiskGiB: config.rootDiskGiB,
    owner,
    orphanGraceMs: config.orphanGraceMs,
    instancePrefix: config.instancePrefix,
    hostAliasPrefix: config.hostAliasPrefix,
    image: config.image,
    guestUser: config.guestUser,
    workspace: config.workspace,
    guestProxy: {
      node: process.execPath,
      script: fileURLToPath(new URL("./guest-proxy.js", import.meta.url)),
      socket: guestRelaySocketOf(stateDir),
    },
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

interface CredentialServices {
  credentials: SecretRecords
}

function credentialRecords(records: () => SecretRecords | undefined): SecretRecords {
  function required(): SecretRecords {
    const found = records()
    if (found === undefined) {
      throw new Error(
        "DSH's credentials service is not available; it keeps the paired VM host's key",
      )
    }
    return found
  }
  return {
    readRecord: (key) => required().readRecord(key),
    modifyRecord: (key, mutate) => required().modifyRecord(key, mutate),
    deleteRecord: (key) => required().deleteRecord(key),
  }
}

const IMAGE_STALL_MS = 60_000

export function imageManagerOf(
  config: Config,
  stateDir: string,
  images: () => Promise<ImageBackend>,
  place: () => string | undefined,
  log: (message: string) => void,
): ImageManager {
  return createImageManager(
    {
      alias: config.image,
      managed: config.manageImage,
      release: releaseOf({
        baseUrl: config.imageBaseUrl,
        manifestSha256: config.imageManifestSha256,
      }),
    },
    {
      importer: createImporter({
        images,
        files: nodeImageFiles,
        http: nodeImageHttp({ stallMs: IMAGE_STALL_MS, userAgent: `dsh-bot-vm/${DSH_VERSION}` }),
        sha256,
        dir: join(stateDir, "images"),
        dshVersion: DSH_VERSION,
        log,
      }),
      place,
      now: Date.now,
      log,
    },
  )
}

export function apply(ctx: Context, config: Config): void {
  const stateDir = expandHome(config.stateDir)
  const settings = settingsOf(config, config.owner === "" ? ownerOf(stateDir) : config.owner)
  let records: SecretRecords | undefined
  let host: VmHost | undefined
  ctx.inject(["credentials"], (scope) => {
    records = (scope as unknown as CredentialServices).credentials
    void host?.check().catch(() => {})
    scope.effect(
      () => () => {
        records = undefined
      },
      "bot-vm: credentials",
    )
  })
  parseProjectName(config.incusProject)
  const log = (message: string) => ctx.logger.info(`bot-vm: ${message}`)
  const clientOf = (endpoint: IncusEndpoint, project: string) => {
    const transport = createIncusTransport(endpoint)
    return {
      incus: createIncusClient({
        transport,
        project,
        operationTimeoutMs: config.operationTimeoutMs,
        requestTimeoutMs: config.incusTimeoutMs,
      }),
      close: () => transport.close(),
    }
  }
  const secrets: Readonly<Record<VmBackendKind, SecretStore>> = {
    incus: recordSecretStore(
      credentialRecords(() => records),
      clientKeyRecord(name),
    ),
    proxmox: recordSecretStore(
      credentialRecords(() => records),
      proxmoxTokenRecord(name),
    ),
  }
  const proxmoxClientOf = (endpoint: ProxmoxEndpoint, node: string) => {
    const transport = createProxmoxTransport(endpoint)
    return {
      client: createProxmoxClient({
        transport,
        node,
        requestTimeoutMs: config.incusTimeoutMs,
        taskTimeoutMs: config.operationTimeoutMs,
        sleep,
      }),
      close: () => transport.close(),
    }
  }
  const proxmoxEndpointOf = (backend: StoredProxmox, tokenSecret: string): ProxmoxEndpoint => ({
    url: backend.url,
    serverCertificateSha256: backend.serverCertificateSha256,
    tokenId: backend.tokenId,
    tokenSecret,
  })
  const connect = (placement: StoredPlacement, secret: string): BackendConnection => {
    const { backend } = placement
    switch (backend.kind) {
      case "incus": {
        const { kind: _, project, ...endpoint } = backend
        const connection = clientOf({ ...endpoint, clientKey: secret }, project)
        return {
          backend: createIncusBackend({
            incus: connection.incus,
            project,
            origin: placement.origin.kind,
            uploadTimeoutMs: config.imageUploadTimeoutMs,
          }),
          close: connection.close,
        }
      }
      case "proxmox": {
        const { kind: _, url, serverCertificateSha256: __, tokenId, ...layout } = backend
        const connection = proxmoxClientOf(proxmoxEndpointOf(backend, secret), layout.node)
        return {
          backend: createProxmoxBackend({
            client: connection.client,
            url,
            tokenId,
            layout,
            owner: settings.owner,
            uploadTimeoutMs: config.imageUploadTimeoutMs,
            unpack: unpackImage,
            connect: tcpGuest,
            reach: tcpReach,
            now: () => new Date(),
          }),
          close: connection.close,
        }
      }
    }
  }
  const scope = createPlacementScope({
    store: filePlacementStore(stateDir, nodeFiles, log),
    secretOf: (kind) => secrets[kind],
    connect,
    placeOf: ({ backend }) => (backend.kind === "incus" ? backend.project : proxmoxPlace(backend)),
  })
  ctx.effect(() => () => scope.close(), "bot-vm: VM host connections")
  const images = imageManagerOf(
    config,
    stateDir,
    async () => (await scope.backend()).images,
    () => scope.place(),
    log,
  )
  ctx.effect(() => () => images.close(), "bot-vm: base image")
  const environment = createVmEnvironment(settings, {
    backend: () => scope.backend(),
    image: images,
    egress: (botId, report) => host?.egress(botId, report),
    hostRipgrep,
    files: nodeFiles,
    run: runCommand,
    sleep,
    now: Date.now,
    log: (message) => ctx.logger.info(message),
  })
  const clientName = `dsh-bots@${hostname()}`
  const pairingDeps: PairingDeps = {
    createIdentity: async (commonName) =>
      createSelfSignedIdentity({ commonName, now: new Date(), usage: "client" }),
    connect: clientOf,
    now: Date.now,
  }
  const sshPaths = setupSshPaths(stateDir)
  const hostSetup = hostSetupOf(fileURLToPath(new URL("./host-setup", import.meta.url)), log)
  host = createVmHost({
    scope,
    proxmox: {
      probe: probeProxmox,
      async verify(backend, tokenSecret, signal) {
        const connection = proxmoxClientOf(proxmoxEndpointOf(backend, tokenSecret), backend.node)
        try {
          await connection.client.version(signal)
        } finally {
          connection.close()
        }
      },
    },
    image: images,
    rehome: () => environment.rehome(),
    pairing: pairingDeps,
    clientName,
    fingerprintOf: certificateFingerprint,
    pinHostKey: pinnedHostKey,
    setupUpdate: (setup: StoredSetup) => setupUpdateOf(hostSetup, setup),
    setup: (vmHost) =>
      createVmHostSetup(
        {
          store: fileSetupJobStore(resolve(stateDir, "setup", "jobs"), nodeSetupFiles, log),
          ssh: createSetupSsh({
            paths: sshPaths,
            files: nodeSetupFiles,
            comment: clientName,
            keygen: generateSetupKey,
            keyscan: scanHostKeys,
            pin: pinnedHostKey,
          }),
          shells: {
            local: () => localShell(hostSetup.dir),
            ssh: (site) => sshShell(sshPaths.config, site),
          },
          bundle: hostSetup.bundle,
          pin: pinnedHostKey,
          owner: settings.owner,
          clientName,
          newId: () => randomBytes(16).toString("hex"),
          now: Date.now,
          later: (ms, run) => {
            const timer = setTimeout(run, ms)
            timer.unref()
            return () => clearTimeout(timer)
          },
          reachable: tcpReachable,
          pair: (request, signal) => pair({ ...request, name: clientName }, pairingDeps, signal),
          importImage: async (signal) => {
            let imported = false
            const stop = () => images.cancel()
            signal.addEventListener("abort", stop, { once: true })
            try {
              await images.ready(signal, () => {
                imported = true
              })
            } finally {
              signal.removeEventListener("abort", stop)
            }
            return imported ? "imported" : "present"
          },
          log,
        },
        vmHost,
      ),
    now: Date.now,
    log: (message) => ctx.logger.info(message),
  })
  const vmHost = host
  ctx.effect(() => () => vmHost.dispose(), "bot-vm: VM host")
  void vmHost
    .check()
    .then(() => images.refresh())
    .catch((error: unknown) =>
      ctx.logger.warn(`bot-vm: looking at the VM host failed: ${String(error)}`),
    )
  const bot = botOf(ctx)
  ctx.effect(() => {
    const relay = startGuestRelay({
      socket: guestRelaySocketOf(stateDir),
      open: (instance, signal) => environment.openGuest(instance, signal),
      log: (message) => ctx.logger.debug(message),
      requestTimeoutMs: 10_000,
    })
    relay.catch((error: unknown) =>
      ctx.logger.error(`bot-vm: the SSH relay did not start: ${String(error)}`),
    )
    return () => relay.then((started) => started.close()).catch(() => {})
  }, "bot-vm: guest relay")
  ctx.effect(() => bot.registerEnvironment({ ...environment, host: vmHost }), "bot-vm: environment")

  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort(), "bot-vm: upkeep")
  const warn = (what: string) => (error: unknown) => {
    if (!lifetime.signal.aborted) ctx.logger.warn(`bot-vm: ${what}: ${String(error)}`)
  }
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

export { hostKeyFingerprint } from "./node/ssh-tools"

interface HostSetupSource {
  readonly dir: string
  bundle(): HostSetupBundle
}

export function hostSetupOf(dir: string, log: (message: string) => void): HostSetupSource {
  let read: { readonly bundle: HostSetupBundle } | { readonly error: Error } | undefined
  return {
    dir,
    bundle() {
      read ??= (() => {
        try {
          return {
            bundle: readHostSetupBundle(dir, {
              read: (path) => readFileSync(path),
              sha256: (content) => createHash("sha256").update(content).digest("hex"),
            }),
          }
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error))
          log(failure.message)
          return { error: failure }
        }
      })()
      if ("error" in read) throw read.error
      return read.bundle
    },
  }
}

export function setupUpdateOf(
  source: HostSetupSource,
  setup: StoredSetup,
): "current" | "available" {
  try {
    return source.bundle().sha256 === setup.bundleSha256 ? "current" : "available"
  } catch {
    return "available"
  }
}
