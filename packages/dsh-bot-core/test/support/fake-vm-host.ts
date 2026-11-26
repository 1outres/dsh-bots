import type { BotEnvironmentHost, VmHostSetup } from "../../src/contract"
import type {
  EnvironmentHostCheck,
  EnvironmentHostPlacement,
  EnvironmentHostView,
  HostOriginView,
} from "../../src/shared/environment-host"
import type {
  HostSiteView,
  PinnedHostKey,
  PreflightCheck,
  SetupFailure,
  SetupFailureCode,
  SetupInspection,
  SetupJobView,
  SetupLogLine,
  SetupSite,
  SetupStartRequest,
  SetupStepId,
  SetupStepView,
  SshIdentityView,
} from "../../src/shared/vm-host-setup"

export interface FakeVmHostOptions {
  readonly placement?: EnvironmentHostPlacement
  readonly thisMachine?: "ready" | "refused"
  readonly stepMs?: number
  readonly now?: () => number
  readonly schedule?: (ms: number, run: () => void) => void
}

export interface FakeVmHost extends BotEnvironmentHost {
  readonly setup: VmHostSetup
}

const STEPS: readonly SetupStepId[] = ["packages", "incus", "firewall", "connect", "image"]
const LOG_TAIL = 200
const IDENTITY_LINE =
  "restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM7vK0b2s3wq1Fh3yE6nq0fDZ8xUq9Lw8pT2cR4mKx1a dsh-bots@fake-host"
export const FAKE_ZABBLY_KEY = "4EFC5906 96CB15B8 7C73A3AD 82CC8797 C838DCFD"

interface Planned {
  readonly step: SetupStepId
  readonly code: SetupFailureCode
  readonly what: string
  readonly fix: string
  readonly command?: string
  readonly exitCode?: number
}

const fingerprintOf = (seed: string, type: string) => {
  let hash = 2166136261
  for (const char of `${type}:${seed}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
  let text = ""
  for (let index = 0; index < 43; index++) {
    hash = Math.imul(hash ^ index, 16777619) >>> 0
    text += alphabet[hash % 64]
  }
  return `SHA256:${text}`
}

function checksOf(site: SetupSite, httpsPort: number, refused: boolean): PreflightCheck[] {
  const os = refused ? "NixOS 25.05 (Warbler)" : "Debian GNU/Linux 12 (bookworm)"
  return [
    { id: "arch", state: "ok", value: "x86_64" },
    refused
      ? {
          id: "os",
          state: "failed",
          value: os,
          what: "NixOS can run DSH but not the VM host setup.",
          fix: "Build the VM host on another machine (Debian, Ubuntu or Fedora).",
        }
      : { id: "os", state: "ok", value: os },
    { id: "kvm", state: "ok", value: "/dev/kvm" },
    { id: "init", state: "ok", value: "systemd" },
    { id: "disk", state: "ok", value: "212 GiB free" },
    {
      id: "privilege",
      state: "ok",
      value: site.kind === "ssh" && site.target.user === "root" ? "root" : "sudo-with-password",
    },
    { id: "incus", state: "ok", value: "absent" },
    refused
      ? { id: "third-party", state: "ok", value: "none" }
      : {
          id: "third-party",
          state: "warning",
          value: "zabbly",
          what: "Incus 6.0.4 or newer comes from Zabbly on Debian 12.",
        },
    { id: "port", state: "ok", value: String(httpsPort) },
  ]
}

function failureOf(request: SetupStartRequest): Planned | null {
  if (request.sudoPassword === "wrong") {
    return {
      step: "packages",
      code: "sudo-rejected",
      what: "sudo did not take the password.",
      fix: "Enter the password of the user again.",
    }
  }
  if (request.project.endsWith("-busy")) {
    return {
      step: "incus",
      code: "project-in-use",
      what: `The project ${request.project} has instances of another owner (owner 5f0c…).`,
      fix: `incus list --project ${request.project} -c n,config:user.dsh-bot.owner`,
      command: `ensure_project ${request.project}`,
      exitCode: 1,
    }
  }
  if (request.httpsPort === 8444) {
    return {
      step: "connect",
      code: "port-in-use",
      what: "Another process listens on 8444.",
      fix: "sudo ss -ltnp 'sport = :8444'",
      command: "ss -ltnH 'sport = :8444'",
      exitCode: 1,
    }
  }
  return null
}

export function createFakeVmHost(options: FakeVmHostOptions = {}): FakeVmHost {
  const now = options.now ?? Date.now
  const schedule =
    options.schedule ??
    ((ms: number, run: () => void) => {
      setTimeout(run, ms)
    })
  const stepMs = options.stepMs ?? 2500
  const listeners = new Set<() => void>()
  let placement: EnvironmentHostPlacement = options.placement ?? { kind: "none" }
  let check: EnvironmentHostCheck = { state: "unchecked" }
  let job: SetupJobView | undefined
  let identity: SshIdentityView = { state: "absent" }
  const inspections = new Map<string, SetupInspection>()
  const sites = new Map<string, SetupSite>()
  let inspectionCount = 0
  let generation = 0

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const view = (): EnvironmentHostView => ({
    placement,
    check,
    egress: [],
    released: [],
    ...(job === undefined ? {} : { setup: job }),
  })
  const update = (change: (current: SetupJobView) => SetupJobView) => {
    if (job === undefined) return
    job = change(job)
    notify()
  }
  const log = (current: SetupJobView, text: string, source: SetupLogLine["source"] = "host") => {
    const tail = [...current.log.tail, { at: now(), source, text }].slice(-LOG_TAIL)
    return { ...current, log: { tail, lines: current.log.lines + 1 } }
  }
  const stepsWith = (
    steps: readonly SetupStepView[],
    id: SetupStepId,
    change: Partial<SetupStepView>,
  ) => steps.map((step) => (step.id === id ? { ...step, ...change } : step))

  const siteView = (site: SetupSite, kept: boolean): HostSiteView =>
    site.kind === "this-machine"
      ? { kind: "this-machine" }
      : {
          kind: "ssh",
          ...site.target,
          hostKey: site.hostKey,
          identity: kept ? "kept" : "removed",
        }

  const succeed = (site: SetupSite, request: SetupStartRequest) => {
    const origin: HostOriginView = {
      kind: "managed",
      site: siteView(site, request.identityAfter !== "remove"),
      completedAt: now(),
      update: "current",
    }
    const host = site.kind === "this-machine" ? "127.0.0.1" : site.target.host
    placement = {
      kind: "placed",
      backend: {
        kind: "incus",
        url: `https://${host}:${request.httpsPort}`,
        project: request.project,
        serverFingerprint: "3f6a9c0e1b2d4f5a6c7e8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5",
        clientFingerprint: "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a291807f6e5d4c3b2a1908f7e6d5c4b",
      },
      origin,
    }
    check = {
      state: "ready",
      at: now(),
      declaration: {
        kind: "incus",
        pool: "dsh-bots",
        network: "dshbr0",
        egressAcl: "dsh-bots-egress",
      },
    }
  }

  const run = (site: SetupSite, request: SetupStartRequest, index: number, mine: number) => {
    if (mine !== generation || job === undefined) return
    const current = job
    if (current.state === "cancelling") {
      const step = STEPS[index] ?? "image"
      update((before) => ({
        ...log(before, "cancelled after the current command", "plugin"),
        state: "cancelled",
        endedAt: now(),
        steps: stepsWith(before.steps, step, { state: "failed", endedAt: now() }),
        failure: {
          step,
          code: "cancelled",
          what: "The build was cancelled.",
          fix: "Try again to continue where it stopped.",
          logTail: before.log.tail.slice(-8).map((line) => line.text),
        },
      }))
      return
    }
    const step = STEPS[index]
    if (step === undefined) {
      succeed(site, request)
      update((before) => ({ ...log(before, "done", "plugin"), state: "succeeded", endedAt: now() }))
      return
    }
    const already = current.attempt > 1 && step !== "image" && step !== "connect"
    update((before) => ({
      ...log(before, `phase ${step} started`),
      steps: stepsWith(before.steps, step, { state: "running", startedAt: now() }),
    }))
    schedule(stepMs, () => {
      if (mine !== generation || job === undefined) return
      if (job.state === "cancelling") {
        run(site, request, index, mine)
        return
      }
      const planned = failureOf(request)
      if (planned !== null && planned.step === step) {
        update((before) => {
          const logged = log(log(before, `+ ${planned.command ?? "sudo -S true"}`), planned.what)
          const failure: SetupFailure = {
            step,
            code: planned.code,
            what: planned.what,
            fix: planned.fix,
            ...(planned.command === undefined ? {} : { command: planned.command }),
            ...(planned.exitCode === undefined ? {} : { exitCode: planned.exitCode }),
            ...(planned.command === undefined ? {} : { location: "infra/incus/objects.sh:142" }),
            logTail: logged.log.tail.slice(-8).map((line) => line.text),
          }
          return {
            ...logged,
            state: "failed",
            endedAt: now(),
            steps: stepsWith(logged.steps, step, { state: "failed", endedAt: now() }),
            failure,
          }
        })
        return
      }
      const note =
        step === "connect"
          ? `core.https_address ${site.kind === "this-machine" ? "127.0.0.1" : ""}:${request.httpsPort}`
          : undefined
      update((before) => ({
        ...log(
          log(before, `+ ${step} commands`),
          `phase ${step} ${already ? "unchanged" : "changed"}`,
        ),
        steps: stepsWith(before.steps, step, {
          state: already ? "skipped" : "done",
          endedAt: now(),
          ...(note === undefined ? {} : { note }),
        }),
      }))
      run(site, request, index + 1, mine)
    })
  }

  const setup: VmHostSetup = {
    async identity() {
      identity = {
        state: "present",
        authorizedKeysLine: IDENTITY_LINE,
        fingerprint: fingerprintOf("identity", "ssh-ed25519"),
      }
      return identity
    },
    async removeIdentity(scope) {
      if (placement.kind !== "placed" || placement.origin.kind !== "managed") {
        throw new Error("no managed VM host uses an SSH key")
      }
      const site = placement.origin.site
      if (site.kind !== "ssh") throw new Error("the VM host is this machine")
      if (scope === "remote-and-local" && site.host.startsWith("stuck")) {
        throw new Error(
          `ssh ${site.user}@${site.host}: connection timed out; remove the line yourself: sed -i '/dsh-bots@fake-host/d' ~/.ssh/authorized_keys`,
        )
      }
      placement = {
        ...placement,
        origin: { ...placement.origin, site: { ...site, identity: "removed" } },
      }
      identity = { state: "absent" }
      notify()
      return identity
    },
    async scanHostKey(target) {
      if (target.host.startsWith("down"))
        throw new Error(`ssh-keyscan ${target.host}: no answer on port ${target.port}`)
      const keys: PinnedHostKey[] = ["ssh-ed25519", "ecdsa-sha2-nistp256"].map((type) => ({
        type,
        fingerprint: fingerprintOf(target.host, type),
      }))
      return { target, keys }
    },
    async inspect(request) {
      const { site, httpsPort } = request
      const refused =
        site.kind === "this-machine"
          ? options.thisMachine === "refused"
          : site.target.host.startsWith("nixos")
      const id = `inspection-${++inspectionCount}`
      const checks = checksOf(site, httpsPort, refused)
      const inspection: SetupInspection = refused
        ? {
            id,
            at: now(),
            site: siteView(site, true),
            checks,
            verdict: "refused",
            ...(site.kind === "this-machine" ? { suggestion: "another-machine" as const } : {}),
          }
        : {
            id,
            at: now(),
            site: siteView(site, true),
            checks,
            verdict: "ready",
            privilege:
              site.kind === "ssh" && site.target.user === "root" ? "root" : "sudo-with-password",
            consents: [
              {
                kind: "third-party-repository",
                id: "zabbly",
                url: "https://pkgs.zabbly.com/incus/stable",
                signingKey: FAKE_ZABBLY_KEY,
              },
            ],
          }
      inspections.clear()
      inspections.set(id, inspection)
      sites.set(id, site)
      return inspection
    },
    start(request) {
      if (job !== undefined && (job.state === "running" || job.state === "cancelling")) {
        throw new Error("setup-busy: a VM host build is running")
      }
      const inspection = inspections.get(request.inspectionId)
      const site = sites.get(request.inspectionId)
      if (inspection === undefined || site === undefined)
        throw new Error("the check is out of date; check again")
      if (inspection.verdict !== "ready") throw new Error("the check refused this VM host")
      const sameSite =
        job !== undefined && JSON.stringify(job.site) === JSON.stringify(inspection.site)
      const again = job !== undefined && job.state !== "succeeded" && sameSite
      generation += 1
      job = {
        id: again && job !== undefined ? job.id : `job-${generation}`,
        attempt: again && job !== undefined ? job.attempt + 1 : 1,
        site: inspection.site,
        project: request.project,
        state: "running",
        steps: STEPS.map((id) => ({ id, state: "pending" })),
        startedAt: now(),
        log: { tail: [], lines: 0 },
      }
      inspections.clear()
      const mine = generation
      notify()
      run(site, request, 0, mine)
      return job
    },
    cancel(jobId) {
      if (job === undefined || job.id !== jobId) throw new Error(`no job ${jobId}`)
      if (job.state === "running") update((before) => ({ ...before, state: "cancelling" }))
      return job
    },
    dismiss(jobId) {
      if (job === undefined || job.id !== jobId) throw new Error(`no job ${jobId}`)
      if (job.state === "running" || job.state === "cancelling")
        throw new Error("the job is running")
      job = undefined
      notify()
    },
    async brief(jobId) {
      if (job === undefined || job.id !== jobId) throw new Error(`no job ${jobId}`)
      if (job.failure === undefined) throw new Error(`the job ${jobId} did not fail`)
      return {
        title: `VM host setup failed: ${job.failure.code}`,
        cwd: `/state/setup/jobs/${job.id}`,
        message: `${job.failure.what}\n${job.failure.fix}`,
      }
    },
  }

  return {
    view,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async check() {
      if (placement.kind === "placed") {
        check = {
          state: "ready",
          at: now(),
          declaration: {
            kind: "incus",
            pool: "dsh-bots",
            network: "dshbr0",
            egressAcl: "dsh-bots-egress",
          },
        }
        notify()
      }
      return view()
    },
    setup,
    custom: {
      preview(credential) {
        if (credential.backend !== "incus") throw new Error("Proxmox comes in a later version")
        return {
          backend: "incus",
          clientName: "dsh-bots",
          serverFingerprint: "aa".repeat(32),
          urls: ["https://10.0.0.5:8443"],
        }
      },
      async connect(request) {
        if (request.backend !== "incus") throw new Error("Proxmox comes in a later version")
        placement = {
          kind: "placed",
          backend: {
            kind: "incus",
            url: request.url,
            project: request.project,
            serverFingerprint: "aa".repeat(32),
            clientFingerprint: "bb".repeat(32),
          },
          origin: { kind: "custom" },
        }
        notify()
        return view()
      },
    },
    async forget() {
      placement = { kind: "none" }
      check = { state: "unchecked" }
      notify()
      return view()
    },
  }
}
