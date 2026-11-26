import type {
  BackendPlacementView,
  BotEnvironmentHost,
  BotEnvironmentImageHost,
  EnvironmentEgressMeasure,
  EnvironmentHostCheck,
  EnvironmentHostPlacement,
  EnvironmentHostRelease,
  EnvironmentHostView,
  HostOriginView,
  HostSiteView,
  VmHostCustom,
  VmHostSetup,
} from "@1outres/dsh-bot-core"
import { parseProjectName } from "./backend/incus/endpoint"
import { type PairingDeps, pair, untrustCommand } from "./backend/incus/pairing"
import { parseTrustToken, tokenUrls } from "./backend/incus/trust-token"
import type { EgressReport } from "./egress-probe"
import type { StoredOrigin, StoredPlacement, StoredSetup, StoredSite } from "./placement/placement"
import { type PlacementScope, problemOf } from "./placement/scope"
import type { PlacementReading } from "./placement/store"

export interface VmHostDeps {
  readonly scope: PlacementScope
  readonly image?: BotEnvironmentImageHost
  readonly rehome: () => void
  readonly pairing: PairingDeps
  readonly clientName: string
  readonly fingerprintOf: (certificate: string) => string
  readonly hostKeyFingerprintOf: (hostKey: string) => string
  readonly setupUpdate: (setup: StoredSetup) => "current" | "available"
  readonly now: () => number
  readonly log: (message: string) => void
}

export interface VmHost extends BotEnvironmentHost {
  egress(botId: string, report: EgressReport): void
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

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

const notYet = (what: string) => () => {
  throw new Error(`${what} is not available in this version of @1outres/dsh-bot-vm`)
}

const UNBUILT_SETUP: VmHostSetup = {
  identity: notYet("building a VM host"),
  removeIdentity: notYet("building a VM host"),
  scanHostKey: notYet("building a VM host"),
  inspect: notYet("building a VM host"),
  start: notYet("building a VM host"),
  cancel: notYet("building a VM host"),
  dismiss: notYet("building a VM host"),
  brief: notYet("building a VM host"),
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

  function siteOf(site: StoredSite): HostSiteView {
    if (site.kind === "this-machine") return site
    const { hostKey, ...rest } = site
    return { ...rest, hostKeyFingerprint: deps.hostKeyFingerprintOf(hostKey) }
  }

  function originOf(origin: StoredOrigin): HostOriginView {
    if (origin.kind === "custom") return origin
    return {
      kind: "managed",
      site: siteOf(origin.site),
      completedAt: origin.setup.completedAt,
      update: deps.setupUpdate(origin.setup),
    }
  }

  function backendOf(stored: StoredPlacement): BackendPlacementView {
    const { backend } = stored
    switch (backend.kind) {
      case "incus":
        return {
          kind: "incus",
          url: backend.url,
          project: backend.project,
          serverFingerprint: backend.serverCertificateSha256,
          clientFingerprint: deps.fingerprintOf(backend.clientCertificate),
        }
      case "proxmox":
        return {
          kind: "proxmox",
          url: backend.url,
          node: backend.node,
          pool: backend.pool,
          tokenId: backend.tokenId,
          serverFingerprint: backend.serverCertificateSha256,
        }
    }
  }

  function placementOf(reading: PlacementReading): EnvironmentHostPlacement {
    switch (reading.kind) {
      case "none":
        return { kind: "none" }
      case "migration-required":
        return { kind: "migration-required", from: { kind: "incus-socket", ...reading.from } }
      case "placed":
        return {
          kind: "placed",
          backend: backendOf(reading.placement),
          origin: originOf(reading.placement.origin),
        }
    }
  }

  async function readPlacement(): Promise<PlacementReading | undefined> {
    try {
      const reading = await scope.reading()
      placement = placementOf(reading)
      return reading
    } catch (error) {
      placement = { kind: "unreadable", problem: problemOf(error) }
      return undefined
    }
  }

  async function runCheck(signal?: AbortSignal): Promise<EnvironmentHostView> {
    const mine = ++checks
    check = { state: "checking" }
    notify()
    let next: EnvironmentHostCheck
    try {
      const { backend } = await scope.current()
      const result = await backend.check(signal)
      next = result.ok
        ? { state: "ready", at: deps.now(), declaration: result.declaration }
        : { state: "failed", at: deps.now(), problems: result.problems }
    } catch (error) {
      next = { state: "failed", at: deps.now(), problems: [problemOf(error)] }
    }
    if (mine === checks) {
      check = next
      notify()
    }
    return view()
  }

  async function leaving(): Promise<void> {
    const reading = await scope.reading().catch(() => undefined)
    if (reading?.kind !== "placed" || reading.placement.backend.kind !== "incus") return
    const { backend } = reading.placement
    const clientFingerprint = deps.fingerprintOf(backend.clientCertificate)
    if (released.some((release) => release.clientFingerprint === clientFingerprint)) return
    released.push({
      url: backend.url,
      clientFingerprint,
      command: untrustCommand(clientFingerprint),
    })
  }

  async function switched(what: string): Promise<EnvironmentHostView> {
    deps.log(`bot-vm: ${what}`)
    egress.clear()
    await readPlacement()
    deps.rehome()
    if (image !== undefined) {
      if (image.view().status.kind === "importing") image.cancel()
      void image.refresh().catch((error: unknown) => {
        deps.log(`bot-vm: looking at the base image failed: ${messageOf(error)}`)
      })
    }
    return runCheck()
  }

  const custom: VmHostCustom = {
    preview(credential) {
      if (credential.backend !== "incus") return notYet("a Proxmox VM host")()
      const token = parseTrustToken(credential.trustToken)
      return {
        backend: "incus",
        clientName: token.clientName,
        serverFingerprint: token.fingerprint,
        urls: tokenUrls(token),
        ...(token.expiresAt === undefined ? {} : { expiresAt: token.expiresAt }),
      }
    },
    async connect(request, signal) {
      if (request.backend !== "incus") return notYet("a Proxmox VM host")()
      const token = parseTrustToken(request.token)
      const project = parseProjectName(request.project)
      await scope.secretUsable("incus")
      const endpoint = await pair(
        { token, url: request.url, project, name: deps.clientName },
        deps.pairing,
        signal,
      )
      await leaving()
      const { clientKey, ...stored } = endpoint
      await scope.choose(
        { version: 3, backend: { kind: "incus", ...stored, project }, origin: { kind: "custom" } },
        clientKey,
      )
      return switched(`paired with the VM host ${endpoint.url} (project ${project})`)
    },
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
      await readPlacement()
      return runCheck(signal)
    },
    setup: UNBUILT_SETUP,
    custom,
    async forget() {
      await leaving()
      await scope.clear()
      return switched("forgot the chosen VM host; bots wait until another one is chosen")
    },
    ...(image === undefined ? {} : { image }),
    egress(botId, report) {
      egress.set(botId, measureOf(report))
      notify()
    },
  }
}
