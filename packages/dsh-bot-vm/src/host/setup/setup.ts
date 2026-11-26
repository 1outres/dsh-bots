import type {
  EnvironmentHostCheck,
  EnvironmentHostPlacement,
  HostSiteView,
  SetupInspection,
  SetupInspectRequest,
  SetupJobView,
  SetupLogLine,
  SetupStartRequest,
  SshIdentityView,
  VmHostSetup,
} from "@1outres/dsh-bot-core"
import { type IncusEndpoint, parseProjectName } from "../backend/incus/endpoint"
import type { StoredPlacement } from "../placement/placement"
import {
  BRIEF_FILE,
  BRIEF_LOG_LINES,
  BRIEF_SCRIPTS_DIR,
  BRIEF_SSH_DIR,
  type HostAccess,
  setupBriefOf,
} from "./brief"
import { type HostSetupEvent, parseHostSetupEvent } from "./events"
import {
  isFinished,
  newSetupJob,
  reduceSetupJob,
  retrySetupJob,
  type SetupInput,
  type SetupJob,
  viewOf,
} from "./job"
import { inspectionOf } from "./preflight"
import { createRedactor } from "./redact"
import { type PairingRequest, type RunningJob, runSetupJob } from "./runner"
import {
  collect,
  HOST_SETUP_ENTRY,
  type HostSetupBundle,
  type HostShell,
  ShellError,
  type ShellPrivilege,
} from "./shell"
import { type PinHostKey, type SetupTarget, sameSite, siteViewOf, type TargetSite } from "./site"
import type { SetupSsh, SshSite } from "./ssh"
import {
  manualRemovalCommand,
  publicKeyBody,
  removeAuthorizedKeyScript,
  VM_HOST_ALIAS,
} from "./ssh-files"
import { type JobFile, logLineText, type SetupJobStore } from "./store"

export const KEPT_JOBS = 5
const TAIL_LINES = 200
const FLUSH_MS = 250

export type SetupRequestErrorCode =
  | "setup-loading"
  | "setup-busy"
  | "inspection-stale"
  | "request-invalid"
  | "job-unknown"
  | "job-running"
  | "identity-missing"
  | "identity-unauthorized"
  | "job-not-failed"

export class SetupRequestError extends Error {
  constructor(
    readonly code: SetupRequestErrorCode,
    message: string,
  ) {
    super(message)
    this.name = "SetupRequestError"
  }
}

export interface SetupShells {
  local(): HostShell
  ssh(site: HostSiteView): HostShell
}

export interface SetupDeps {
  readonly store: SetupJobStore
  readonly ssh: SetupSsh
  readonly shells: SetupShells
  bundle(): HostSetupBundle
  readonly pin: PinHostKey
  readonly owner: string
  readonly clientName: string
  readonly newId: () => string
  readonly now: () => number
  readonly later: (ms: number, run: () => void) => () => void
  reachable(url: string, signal: AbortSignal): Promise<void>
  pair(request: PairingRequest, signal: AbortSignal): Promise<IncusEndpoint>
  importImage(signal: AbortSignal): Promise<"present" | "imported">
  readonly log: (message: string) => void
}

export interface SetupHost {
  placement(): EnvironmentHostPlacement
  pinnedSites(): Promise<readonly SshSite[]>
  replaceableClient(site: TargetSite): Promise<string | undefined>
  adopt(placement: StoredPlacement, clientKey: string): Promise<void>
  settle(): Promise<EnvironmentHostCheck>
  identityRemoved(): Promise<void>
  notify(): void
}

export interface ManagedSetup extends VmHostSetup {
  view(): SetupJobView | undefined
  load(): Promise<void>
  close(): void
}

interface Inspected {
  readonly inspection: SetupInspection
  readonly site: TargetSite
  readonly httpsPort: number
  readonly replaceClient?: string
}

interface Entry {
  job: SetupJob
  lines: number
  tail: SetupLogLine[]
  pending: SetupLogLine[]
  runner?: RunningJob
}

const RETRYABLE = new Set(["failed", "cancelled", "interrupted"])
const INVESTIGABLE = new Set(["failed", "interrupted"])
const decoder = new TextDecoder()
const UNAUTHORIZED = /Permission denied \(publickey/

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function validPort(port: number): number {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new SetupRequestError("request-invalid", `${port} is not a port`)
  }
  return port
}

export function createVmHostSetup(deps: SetupDeps, host: SetupHost): ManagedSetup {
  const entries = new Map<string, Entry>()
  let loaded = false
  let closed = false
  let latest: Inspected | undefined
  let flushTimer: (() => void) | undefined

  const ordered = () => [...entries.values()].sort((a, b) => a.job.startedAt - b.job.startedAt)
  const runningEntry = () => ordered().find((entry) => !isFinished(entry.job.state))

  function entryOf(jobId: string): Entry {
    const entry = entries.get(jobId)
    if (entry === undefined)
      throw new SetupRequestError("job-unknown", `there is no setup job ${jobId}`)
    return entry
  }

  const save = (entry: Entry) =>
    deps.store.save(entry.job, entry.lines).catch((error: unknown) => {
      deps.log(`saving the setup job ${entry.job.id} failed: ${messageOf(error)}`)
    })

  function flush() {
    flushTimer = undefined
    for (const entry of entries.values()) {
      if (entry.pending.length === 0) continue
      const lines = entry.pending
      entry.pending = []
      void deps.store.append(entry.job.id, lines).catch((error: unknown) => {
        deps.log(`writing the log of the setup job ${entry.job.id} failed: ${messageOf(error)}`)
      })
    }
    host.notify()
  }

  function log(entry: Entry, source: SetupLogLine["source"], text: string) {
    const line = { at: deps.now(), source, text }
    entry.tail.push(line)
    if (entry.tail.length > TAIL_LINES) entry.tail.splice(0, entry.tail.length - TAIL_LINES)
    entry.pending.push(line)
    entry.lines++
    flushTimer ??= deps.later(FLUSH_MS, flush)
  }

  const shape = (job: SetupJob) =>
    JSON.stringify([job.state, job.steps, job.failure, job.dismissed, job.attempt])

  function apply(entry: Entry, input: SetupInput) {
    const before = shape(entry.job)
    entry.job = reduceSetupJob(entry.job, input)
    if (shape(entry.job) === before) return
    flushTimer?.()
    flush()
    void save(entry)
  }

  const tailText = (entry: Entry, count: number) =>
    entry.tail.slice(-count).map((line) => line.text)

  async function pointedShell(site: TargetSite, view: HostSiteView): Promise<HostShell> {
    if (site.kind === "this-machine") return deps.shells.local()
    await deps.ssh.point(site)
    return deps.shells.ssh(view)
  }

  async function knownSites(): Promise<readonly SshSite[]> {
    const fromJobs = ordered().flatMap((entry) =>
      entry.job.target.site.kind === "ssh" ? [entry.job.target.site] : [],
    )
    return [...(await host.pinnedSites()), ...fromJobs]
  }

  async function removeRemote(site: SshSite): Promise<void> {
    const key = await deps.ssh.publicKey()
    if (key === undefined) return
    const body = publicKeyBody(key)
    const shell = await pointedShell(site, siteViewOf(site, "kept", deps.pin))
    const run = await collect(
      shell.run({
        argv: ["sh", "-c", removeAuthorizedKeyScript(body)],
        env: {},
        privilege: { kind: "user" },
      }),
    )
    if (run.exit.code !== 0) {
      throw new Error(
        `removing the key from ${site.user}@${site.host} failed (${run.exit.broken?.message ?? run.stderr.slice(-2).join(" ")}); remove it there by hand: ${manualRemovalCommand(body)}`,
      )
    }
  }

  async function removeIdentityOf(site: SshSite | undefined): Promise<SshIdentityView> {
    if (site !== undefined) await removeRemote(site)
    const view = await deps.ssh.removeLocal()
    await host.identityRemoved()
    return view
  }

  async function preflight(
    site: TargetSite,
    view: HostSiteView,
    httpsPort: number,
    signal?: AbortSignal,
  ) {
    const bundle = deps.bundle()
    const shell = await pointedShell(site, view)
    try {
      const staged = await shell.stage(bundle, signal).catch((error: unknown) => {
        if (error instanceof ShellError && UNAUTHORIZED.test(error.message))
          throw unauthorized(site)
        throw error
      })
      try {
        const run = await collect(
          shell.run(
            {
              argv: ["bash", `${staged.dir}/${HOST_SETUP_ENTRY}`, "--events", "preflight"],
              env: { HTTPS_PORT: String(httpsPort) },
              privilege: { kind: "user" },
            },
            signal,
          ),
        )
        if (run.exit.broken !== undefined)
          throw new ShellError(run.exit.broken.code, run.exit.broken.message)
        const events: HostSetupEvent[] = run.stdout.map(parseHostSetupEvent)
        if (run.exit.code !== 0 && events.at(-1)?.type !== "end") {
          throw new Error(
            `host-setup.sh preflight stopped with exit code ${run.exit.code}: ${run.stderr.slice(-3).join(" ")}`,
          )
        }
        return events
      } finally {
        await staged.release().catch(() => {})
      }
    } finally {
      await shell.dispose()
    }
  }

  function unauthorized(site: TargetSite): SetupRequestError {
    const where = site.kind === "ssh" ? `${site.user}@${site.host}` : "the VM host"
    return new SetupRequestError(
      "identity-unauthorized",
      `${where} does not accept this installation's SSH key yet; add its line to ~/.ssh/authorized_keys there`,
    )
  }

  async function targetSiteOf(request: SetupInspectRequest): Promise<TargetSite> {
    const { site } = request
    if (site.kind === "this-machine") return site
    if ((await deps.ssh.publicKey()) === undefined) {
      throw new SetupRequestError(
        "identity-missing",
        "this installation has no SSH key for VM hosts yet",
      )
    }
    return deps.ssh.resolve(site.target, site.hostKey, await knownSites())
  }

  function privilegeOf(
    inspection: Extract<SetupInspection, { verdict: "ready" }>,
    password: string | undefined,
  ): ShellPrivilege {
    switch (inspection.privilege) {
      case "root":
        return { kind: "root", via: "already-root" }
      case "sudo-without-password":
        return { kind: "root", via: "sudo", password: undefined }
      case "sudo-with-password":
        if (password === undefined || password === "") {
          throw new SetupRequestError("request-invalid", "the VM host's sudo needs the password")
        }
        return { kind: "root", via: "sudo", password }
    }
  }

  function prune() {
    const all = ordered()
    for (const entry of all.slice(0, Math.max(0, all.length - KEPT_JOBS))) {
      entries.delete(entry.job.id)
      void deps.store.remove(entry.job.id).catch(() => {})
    }
  }

  function begin(
    entry: Entry,
    inspected: Inspected,
    privilege: ShellPrivilege,
    password: string | undefined,
  ) {
    const { site } = inspected
    entry.runner = runSetupJob(
      {
        shell: site.kind === "this-machine" ? deps.shells.local() : deps.shells.ssh(entry.job.site),
        bundle: deps.bundle(),
        privilege,
        ...(inspected.replaceClient === undefined
          ? {}
          : { replaceClient: inspected.replaceClient }),
        redactor: createRedactor([password]),
      },
      {
        owner: deps.owner,
        clientName: deps.clientName,
        now: deps.now,
        later: deps.later,
        reachable: deps.reachable,
        pair: deps.pair,
        adopt: host.adopt,
        settle: host.settle,
        importImage: deps.importImage,
        removeIdentity: async () => {
          await removeIdentityOf(site.kind === "ssh" ? site : undefined)
        },
      },
      {
        job: () => entry.job,
        apply: (input) => apply(entry, input),
        log: (source, text) => log(entry, source, text),
        tail: (count) => tailText(entry, count),
      },
    )
    void entry.runner.done.finally(() => {
      entry.runner = undefined
      flush()
    })
  }

  async function accessOf(
    site: TargetSite,
    dir: string,
  ): Promise<{
    readonly access: HostAccess
    readonly files: readonly JobFile[]
  }> {
    if (site.kind === "this-machine") return { access: site, files: [] }
    if ((await deps.ssh.publicKey()) === undefined) {
      return { access: { kind: "ssh-without-key" }, files: [] }
    }
    const client = deps.ssh.clientConfig(site, `${dir}/${BRIEF_SSH_DIR}/known_hosts`)
    return {
      access: { kind: "ssh", config: `${dir}/${BRIEF_SSH_DIR}/config`, alias: VM_HOST_ALIAS },
      files: [
        { path: `${BRIEF_SSH_DIR}/config`, content: client.config, mode: 0o600 },
        { path: `${BRIEF_SSH_DIR}/known_hosts`, content: client.knownHosts, mode: 0o600 },
      ],
    }
  }

  const viewOfEntry = (entry: Entry): SetupJobView =>
    viewOf(entry.job, { tail: [...entry.tail], lines: entry.lines })

  return {
    view() {
      const shown = ordered()
        .filter((entry) => !entry.job.dismissed)
        .at(-1)
      return shown === undefined ? undefined : viewOfEntry(shown)
    },
    async load() {
      for (const stored of await deps.store.load()) {
        const tail = [...(await deps.store.tail(stored.job.id, TAIL_LINES))]
        const entry: Entry = { job: stored.job, lines: stored.lines, tail, pending: [] }
        entries.set(stored.job.id, entry)
        if (!isFinished(entry.job.state)) {
          entry.job = reduceSetupJob(entry.job, {
            kind: "interrupt",
            at: deps.now(),
            logTail: tailText(entry, 40),
          })
          await save(entry)
        }
      }
      loaded = true
      host.notify()
    },
    close() {
      closed = true
      for (const entry of entries.values()) entry.runner?.stop()
      flushTimer?.()
      flush()
    },
    identity: () => deps.ssh.identity(),
    async removeIdentity(scope) {
      if (scope === "local") return removeIdentityOf(undefined)
      const placed = await host.pinnedSites()
      const lastJob = ordered()
        .flatMap((entry) => (entry.job.target.site.kind === "ssh" ? [entry.job.target.site] : []))
        .at(-1)
      const site = placed[0] ?? lastJob
      if (site === undefined) {
        throw new SetupRequestError(
          "request-invalid",
          "no VM host reached over SSH is known; remove the key only here",
        )
      }
      return removeIdentityOf(site)
    },
    scanHostKey: (target, signal) => deps.ssh.scan(target, signal),
    async inspect(request, signal) {
      if (closed) throw new SetupRequestError("setup-loading", "the plugin is stopping")
      const httpsPort = validPort(request.httpsPort)
      const site = await targetSiteOf(request)
      const view = siteViewOf(site, "kept", deps.pin)
      const events = await preflight(site, view, httpsPort, signal)
      const inspection = inspectionOf({ id: deps.newId(), at: deps.now(), site: view, events })
      const replaceClient = await host.replaceableClient(site)
      latest = {
        inspection,
        site,
        httpsPort,
        ...(replaceClient === undefined ? {} : { replaceClient }),
      }
      return inspection
    },
    start(request: SetupStartRequest) {
      if (!loaded || closed)
        throw new SetupRequestError("setup-loading", "the setup jobs are still being read")
      const busy = runningEntry()
      if (busy !== undefined)
        throw new SetupRequestError("setup-busy", `the setup job ${busy.job.id} is still running`)
      const inspected = latest
      if (inspected === undefined || inspected.inspection.id !== request.inspectionId) {
        throw new SetupRequestError(
          "inspection-stale",
          "check the VM host again before building it",
        )
      }
      const { inspection } = inspected
      if (inspection.verdict !== "ready") {
        throw new SetupRequestError("request-invalid", "the VM host's check refused it")
      }
      if (request.httpsPort !== inspected.httpsPort) {
        throw new SetupRequestError(
          "inspection-stale",
          "the HTTPS port changed; check the VM host again",
        )
      }
      let project: string
      try {
        project = parseProjectName(request.project)
      } catch (error) {
        throw new SetupRequestError("request-invalid", messageOf(error))
      }
      const placement = host.placement()
      if (
        placement.kind === "migration-required" &&
        inspected.site.kind === "this-machine" &&
        placement.from.project !== project
      ) {
        throw new SetupRequestError(
          "request-invalid",
          `moving this machine's VM host keeps its project ${placement.from.project}`,
        )
      }
      const missing = inspection.consents.filter(
        (consent) => !request.consents.includes(consent.id),
      )
      if (missing.length > 0) {
        throw new SetupRequestError(
          "request-invalid",
          `the setup needs consent to ${missing.map((consent) => consent.url).join(", ")}`,
        )
      }
      if (inspected.site.kind === "this-machine" && request.identityAfter === "remove") {
        throw new SetupRequestError("request-invalid", "this machine is built without an SSH key")
      }
      const privilege = privilegeOf(inspection, request.sudoPassword)
      const target: SetupTarget = {
        site: inspected.site,
        project,
        httpsPort: inspected.httpsPort,
        consents: inspection.consents.map((consent) => consent.id),
        identityAfter: request.identityAfter ?? "keep",
      }
      latest = undefined
      const at = deps.now()
      const fresh = { id: deps.newId(), at, site: inspection.site, target }
      const previous = ordered()
        .filter((entry) => sameSite(target.site, entry.job.target.site))
        .at(-1)
      const continued =
        previous !== undefined &&
        RETRYABLE.has(previous.job.state) &&
        previous.job.target.project === project
      const entry: Entry = continued
        ? { ...previous, job: retrySetupJob(previous.job, fresh), pending: [] }
        : { job: newSetupJob(fresh), lines: 0, tail: [], pending: [] }
      entries.set(entry.job.id, entry)
      prune()
      void save(entry)
      begin(entry, inspected, privilege, request.sudoPassword)
      host.notify()
      return viewOfEntry(entry)
    },
    cancel(jobId) {
      const entry = entryOf(jobId)
      entry.runner?.cancel()
      return viewOfEntry(entry)
    },
    dismiss(jobId) {
      const entry = entryOf(jobId)
      if (!isFinished(entry.job.state))
        throw new SetupRequestError("job-running", `the setup job ${jobId} is still running`)
      apply(entry, { kind: "dismiss" })
      host.notify()
    },
    async brief(jobId) {
      const entry = entryOf(jobId)
      const { failure } = entry.job
      if (!INVESTIGABLE.has(entry.job.state) || failure === undefined) {
        throw new SetupRequestError("job-not-failed", `the setup job ${jobId} did not fail`)
      }
      flushTimer?.()
      flush()
      const cwd = deps.store.dir(jobId)
      const bundle = deps.bundle()
      const { access, files } = await accessOf(entry.job.target.site, cwd)
      const brief = setupBriefOf({
        job: entry.job,
        failure,
        cwd,
        logTail: entry.tail.slice(-BRIEF_LOG_LINES).map(logLineText),
        logLines: entry.lines,
        bundleSha256: bundle.sha256,
        access,
      })
      await deps.store.attach(jobId, [
        ...bundle.files.map((file) => ({
          path: `${BRIEF_SCRIPTS_DIR}/${file.path}`,
          content: decoder.decode(file.content),
          mode: 0o600,
        })),
        ...files,
        { path: BRIEF_FILE, content: `${brief.message}\n`, mode: 0o600 },
      ])
      return brief
    },
  }
}
