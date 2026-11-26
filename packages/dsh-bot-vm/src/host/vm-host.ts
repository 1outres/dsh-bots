import type {
  BotEnvironmentHost,
  BotEnvironmentImageHost,
  EnvironmentEgressMeasure,
  EnvironmentHostCheck,
  EnvironmentHostPlacement,
  EnvironmentHostProblem,
  EnvironmentHostRelease,
  EnvironmentHostView,
} from "@1outres/dsh-bot-core"
import type { EgressReport } from "./egress-probe"
import { parseProjectName, type StoredScope } from "./endpoint"
import { checkEndpoint } from "./endpoint-check"
import type { EndpointScope } from "./endpoint-scope"
import { type PairingDeps, pair, untrustCommand } from "./pairing"
import { parseTrustToken, tokenUrls } from "./trust-token"

export interface VmHostDeps {
  readonly scope: EndpointScope
  readonly image?: BotEnvironmentImageHost
  readonly rehome: () => void
  readonly pairing: PairingDeps
  readonly clientName: string
  readonly fingerprintOf: (certificate: string) => string
  readonly now: () => number
  readonly log: (message: string) => void
}

export interface VmHost extends BotEnvironmentHost {
  egress(botId: string, report: EgressReport): void
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const CHOOSE_AGAIN = "choose the VM host again in the dsh-bots settings"

function measureOf(report: EgressReport): EnvironmentEgressMeasure {
  switch (report.state) {
    case "isolated":
      return { state: "isolated", at: report.at }
    case "open":
      return { state: "open", at: report.at, reached: report.reached }
    case "unmeasured":
      return { state: "unmeasured", at: report.at, reason: report.reason }
  }
}

export function createVmHost(deps: VmHostDeps): VmHost {
  const { scope, image } = deps
  const listeners = new Set<() => void>()
  let placement: EnvironmentHostPlacement = { kind: "reading" }
  let check: EnvironmentHostCheck = { state: "unchecked" }
  let checks = 0
  const egress = new Map<string, EnvironmentEgressMeasure>()
  const released: EnvironmentHostRelease[] = []

  const notify = () => {
    for (const listener of [...listeners]) listener()
  }

  const view = (): EnvironmentHostView => ({
    placement,
    check,
    egress: [...egress].map(([botId, measure]) => ({ botId, measure })),
    released: [...released],
    ...(image === undefined ? {} : { image: image.view() }),
  })

  function placementOf(stored: StoredScope, chosen: boolean): EnvironmentHostPlacement {
    const { endpoint, project } = stored
    return endpoint.kind === "local"
      ? { kind: "local", socket: endpoint.socket, project, chosen }
      : {
          kind: "remote",
          url: endpoint.url,
          project,
          serverFingerprint: endpoint.serverCertificateSha256,
          clientFingerprint: deps.fingerprintOf(endpoint.clientCertificate),
        }
  }

  const unreadable = (error: unknown): EnvironmentHostProblem => ({
    code: "stored-unreadable",
    message: `the chosen VM host cannot be used: ${messageOf(error)}`,
    fix: CHOOSE_AGAIN,
  })

  async function readPlacement(): Promise<StoredScope | undefined> {
    try {
      const stored = await scope.stored()
      placement =
        stored === undefined ? placementOf(scope.defaults, false) : placementOf(stored, true)
      return stored
    } catch (error) {
      placement = { kind: "unreadable", problem: unreadable(error) }
      throw error
    }
  }

  async function runCheck(signal?: AbortSignal): Promise<EnvironmentHostView> {
    const mine = ++checks
    check = { state: "checking" }
    notify()
    let next: EnvironmentHostCheck
    try {
      const active = await scope.current()
      placement = placementOf(active.stored, active.chosen)
      const result = await checkEndpoint(
        { incus: active.incus, kind: active.kind, project: active.project },
        signal,
      )
      next = result.ok
        ? {
            state: "ready",
            at: deps.now(),
            declaration: {
              pool: result.declaration.pool,
              network: result.declaration.network,
              ...(result.declaration.egressAcl === undefined
                ? {}
                : { egressAcl: result.declaration.egressAcl }),
            },
          }
        : { state: "failed", at: deps.now(), problems: result.problems }
    } catch (error) {
      const problem = unreadable(error)
      placement = { kind: "unreadable", problem }
      next = { state: "failed", at: deps.now(), problems: [problem] }
    }
    if (mine === checks) {
      check = next
      notify()
    }
    return view()
  }

  async function leaving(): Promise<void> {
    let stored: StoredScope | undefined
    try {
      stored = await scope.stored()
    } catch {
      return
    }
    if (stored?.endpoint.kind !== "remote") return
    const clientFingerprint = deps.fingerprintOf(stored.endpoint.clientCertificate)
    if (released.some((release) => release.clientFingerprint === clientFingerprint)) return
    released.push({
      url: stored.endpoint.url,
      clientFingerprint,
      command: untrustCommand(clientFingerprint),
    })
  }

  async function switched(what: string): Promise<EnvironmentHostView> {
    deps.log(`bot-vm: ${what}`)
    egress.clear()
    await readPlacement().catch(() => {})
    deps.rehome()
    if (image !== undefined) {
      if (image.view().status.kind === "importing") image.cancel()
      void image.refresh().catch((error: unknown) => {
        deps.log(`bot-vm: looking at the base image failed: ${messageOf(error)}`)
      })
    }
    return runCheck()
  }

  const offImage = image?.subscribe(notify)

  return {
    dispose: () => offImage?.(),
    view,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async check(signal) {
      await readPlacement().catch(() => {})
      return runCheck(signal)
    },
    previewToken(text) {
      const token = parseTrustToken(text)
      return {
        clientName: token.clientName,
        serverFingerprint: token.fingerprint,
        urls: tokenUrls(token),
        ...(token.expiresAt === undefined ? {} : { expiresAt: token.expiresAt }),
      }
    },
    async pair(pairing, signal) {
      const token = parseTrustToken(pairing.token)
      const project = parseProjectName(pairing.project)
      await scope.keysUsable()
      const paired = await pair(
        { token, url: pairing.url, name: deps.clientName },
        deps.pairing,
        signal,
      )
      const previous = await scope.stored().catch(() => undefined)
      if (
        previous?.endpoint.kind !== "remote" ||
        previous.endpoint.clientCertificate !== paired.endpoint.clientCertificate
      ) {
        await leaving()
      }
      await scope.choose({ endpoint: paired.endpoint, project }, paired.clientKey)
      return switched(`paired with the VM host ${paired.endpoint.url} (project ${project})`)
    },
    async useLocal(text) {
      const project = parseProjectName(text)
      await leaving()
      await scope.choose({ endpoint: scope.defaults.endpoint, project })
      return switched(`using this machine's Incus (project ${project})`)
    },
    async setProject(text) {
      const project = parseProjectName(text)
      await scope.setProject(project)
      return switched(`using the project ${project}`)
    },
    async forget() {
      await leaving()
      await scope.clear()
      return switched("forgot the chosen VM host; this machine's Incus is used by default")
    },
    ...(image === undefined ? {} : { image }),
    egress(botId, report) {
      egress.set(botId, measureOf(report))
      notify()
    },
  }
}
