import type {
  EnvironmentHostProblem,
  PlacementProblemCode,
  ProblemFix,
  VmBackendKind,
} from "@1outres/dsh-bot-core"
import type { VmBackend } from "../backend/contract"
import type { StoredPlacement } from "./placement"
import type { ClientKeyStore } from "./secrets"
import type { PlacementReading, PlacementStore } from "./store"

export class PlacementError extends Error {
  constructor(readonly problem: EnvironmentHostProblem) {
    super(problem.message)
    this.name = "PlacementError"
  }
}

const CHOOSE_HOST: ProblemFix = { kind: "choose-host" }

export function placementProblem(
  code: PlacementProblemCode,
  message: string,
  fix: ProblemFix = CHOOSE_HOST,
): EnvironmentHostProblem {
  return { scope: "placement", code, message, fix }
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function problemOf(error: unknown): EnvironmentHostProblem {
  if (error instanceof PlacementError) return error.problem
  return placementProblem(
    "stored-unreadable",
    `the chosen VM host cannot be used: ${messageOf(error)}`,
  )
}

export interface BackendConnection {
  readonly backend: VmBackend
  close(): void
}

export interface PlacementScopeDeps {
  readonly store: PlacementStore
  secretOf(kind: VmBackendKind): ClientKeyStore
  connect(placement: StoredPlacement, secret: string): BackendConnection
}

export interface ActivePlacement {
  readonly placement: StoredPlacement
  readonly backend: VmBackend
}

export interface PlacementScope {
  reading(): Promise<PlacementReading>
  current(): Promise<ActivePlacement>
  backend(): Promise<VmBackend>
  project(): string | undefined
  secretUsable(kind: VmBackendKind): Promise<void>
  choose(placement: StoredPlacement, secret: string): Promise<void>
  rewrite(placement: StoredPlacement): Promise<void>
  clear(): Promise<void>
  close(): void
}

interface Connected {
  readonly active: ActivePlacement
  readonly connection: BackendConnection
}

const projectOf = (placement: StoredPlacement) =>
  placement.backend.kind === "incus" ? placement.backend.project : undefined

export function createPlacementScope(deps: PlacementScopeDeps): PlacementScope {
  let resolved: Promise<Connected> | undefined
  let latest: string | undefined

  async function placed(): Promise<StoredPlacement> {
    const reading = await deps.store.read()
    switch (reading.kind) {
      case "none":
        throw new PlacementError(placementProblem("placement-none", "no VM host is chosen"))
      case "migration-required":
        throw new PlacementError(
          placementProblem(
            "migration-required",
            `this machine's Incus socket (${reading.from.socket}, project ${reading.from.project}) is no longer used; the VM host must move to HTTPS`,
            { kind: "text", text: "move this machine's VM host in the dsh-bots settings" },
          ),
        )
      case "placed":
        return reading.placement
    }
  }

  async function resolve(): Promise<Connected> {
    const placement = await placed()
    const secret = await deps.secretOf(placement.backend.kind).read()
    if (secret === undefined) {
      throw new PlacementError(
        placementProblem(
          "secret-missing",
          `the key for the VM host ${placement.backend.url} is missing from DSH's secret store`,
        ),
      )
    }
    const connection = deps.connect(placement, secret)
    latest = projectOf(placement)
    return { connection, active: { placement, backend: connection.backend } }
  }

  function drop(): void {
    const earlier = resolved
    resolved = undefined
    void earlier?.then(
      ({ connection }) => connection.close(),
      () => {},
    )
  }

  async function previousKind(): Promise<VmBackendKind | undefined> {
    const reading = await deps.store.read()
    return reading.kind === "placed" ? reading.placement.backend.kind : undefined
  }

  async function current(): Promise<ActivePlacement> {
    resolved ??= resolve()
    const attempt = resolved
    try {
      return (await attempt).active
    } catch (error) {
      if (resolved === attempt) {
        resolved = undefined
        latest = undefined
      }
      throw error
    }
  }

  return {
    reading: () => deps.store.read(),
    current,
    backend: async () => (await current()).backend,
    project: () => latest,
    async secretUsable(kind) {
      await deps.secretOf(kind).read()
    },
    async choose(placement, secret) {
      const before = await previousKind().catch(() => undefined)
      await deps.secretOf(placement.backend.kind).write(secret)
      if (before !== undefined && before !== placement.backend.kind) {
        await deps.secretOf(before).clear()
      }
      await deps.store.write(placement)
      drop()
      latest = projectOf(placement)
    },
    async rewrite(placement) {
      await deps.store.write(placement)
      drop()
    },
    async clear() {
      const before = await previousKind().catch(() => undefined)
      if (before !== undefined) await deps.secretOf(before).clear()
      await deps.store.clear()
      drop()
      latest = undefined
    },
    close: drop,
  }
}
