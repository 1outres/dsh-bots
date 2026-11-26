import type { BotConnectorContext } from "../../connector-contract"
import type { ConnectorPreparationStage, ConnectorReadiness } from "../../shared/connectors"
import { canonicalJson } from "./action"
import type { CatalogConnector, ConnectorCatalog } from "./catalog"
import { dependentsOf, requirementState } from "./requirements"
import type { ConnectorSettings } from "./settings"

export type EnvironmentState =
  | {
      readonly ready: true
      readonly generation: string
    }
  | { readonly ready: false; readonly reason: string }

export interface ConnectorReadinessDeps {
  catalog: Pick<ConnectorCatalog, "list" | "get">
  settings: Pick<ConnectorSettings, "view">
  bots(): Iterable<string>
  exists(botId: string): boolean
  environment(botId: string): EnvironmentState
  accounts(botId: string, connector: CatalogConnector): string | undefined
  context(
    botId: string,
    connector: CatalogConnector,
    signal: AbortSignal,
  ): BotConnectorContext | undefined
  now(): number
  later(ms: number, work: () => void): () => void
  warn(message: string): void
  retryMs?: number
  maxRetryMs?: number
}

export interface ConnectorReadinessKeeper {
  state(botId: string, connectorId: string): ConnectorReadiness
  sync(botId?: string): void
  retry(botId: string, connectorId: string): void
  subscribe(listener: (botId: string, connectorId: string) => void): () => void
  dispose(): void
}

interface Job {
  readonly key: string
  readonly controller: AbortController
}

interface Entry {
  readiness: ConnectorReadiness
  prepared?: string | undefined
  started: boolean
  running?: Job | undefined
  queued?: string | undefined
  failures: number
  failedKey?: string | undefined
  cancelRetry?: (() => void) | undefined
}

const DISABLED: ConnectorReadiness = { state: "disabled" }

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const needsEnvironment = (connector: CatalogConnector) => connector.preparation !== undefined

export function createConnectorReadiness(deps: ConnectorReadinessDeps): ConnectorReadinessKeeper {
  const retryMs = deps.retryMs ?? 5_000
  const maxRetryMs = deps.maxRetryMs ?? 300_000
  const entries = new Map<string, Entry>()
  const queues = new Map<string, Promise<void>>()
  const listeners = new Set<(botId: string, connectorId: string) => void>()
  let closed = false

  const keyOf = (botId: string, connectorId: string) => `${botId}\u0000${connectorId}`
  const entryOf = (botId: string, connectorId: string) => {
    const key = keyOf(botId, connectorId)
    let entry = entries.get(key)
    if (entry === undefined) {
      entry = { readiness: DISABLED, started: false, failures: 0 }
      entries.set(key, entry)
    }
    return entry
  }

  const set = (botId: string, connectorId: string, entry: Entry, next: ConnectorReadiness) => {
    if (JSON.stringify(entry.readiness) === JSON.stringify(next)) return
    entry.readiness = next
    for (const listener of [...listeners]) {
      try {
        listener(botId, connectorId)
      } catch (error) {
        deps.warn(`bot-core: a connector readiness listener failed: ${messageOf(error)}`)
      }
    }
    for (const dependent of dependentsOf(deps.catalog.list(), connectorId)) {
      evaluate(botId, dependent.id)
    }
  }

  const stateOf = (botId: string, connectorId: string): ConnectorReadiness =>
    entries.get(keyOf(botId, connectorId))?.readiness ?? DISABLED

  const halt = (entry: Entry) => {
    abort(entry)
    cancelRetry(entry)
    entry.queued = undefined
    entry.prepared = undefined
  }

  const preparing = (entry: Entry, stage: ConnectorPreparationStage): ConnectorReadiness => {
    const current = entry.readiness
    if (current.state !== "preparing") return { state: "preparing", since: stage.since, stage }
    const same =
      JSON.stringify({ ...current.stage, since: 0 }) === JSON.stringify({ ...stage, since: 0 })
    return { state: "preparing", since: current.since, stage: same ? current.stage : stage }
  }

  const ready = (entry: Entry): ConnectorReadiness =>
    entry.readiness.state === "ready" ? entry.readiness : { state: "ready", since: deps.now() }

  const cancelRetry = (entry: Entry) => {
    entry.cancelRetry?.()
    entry.cancelRetry = undefined
    entry.failedKey = undefined
  }

  const abort = (entry: Entry) => {
    entry.running?.controller.abort()
  }

  const enqueue = (botId: string, work: () => Promise<void>) => {
    const previous = queues.get(botId) ?? Promise.resolve()
    const next = previous.then(work).catch((error: unknown) => {
      deps.warn(
        `bot-core: a connector preparation of bot "${botId}" failed unexpectedly: ${messageOf(error)}`,
      )
    })
    queues.set(botId, next)
    void next.then(() => {
      if (queues.get(botId) === next) queues.delete(botId)
    })
  }

  const wanted = (botId: string, connector: CatalogConnector | undefined) => {
    if (connector === undefined || !deps.exists(botId)) return undefined
    const view = deps.settings.view(botId, connector)
    return view.enabled ? view : undefined
  }

  const unprepare = (botId: string, connector: CatalogConnector) => {
    const preparation = connector.preparation
    if (preparation?.unprepare === undefined) return
    const run = (context: BotConnectorContext) => preparation.unprepare?.(context)
    enqueue(botId, async () => {
      if (closed || wanted(botId, deps.catalog.get(connector.id)) !== undefined) return
      const controller = new AbortController()
      const context = deps.context(botId, connector, controller.signal)
      if (context === undefined) return
      try {
        await run(context)
      } catch (error) {
        deps.warn(
          `bot-core: connector "${connector.id}" could not undo its preparation for bot "${botId}": ${messageOf(error)}`,
        )
      }
    })
  }

  const prepare = (botId: string, connector: CatalogConnector, entry: Entry, key: string) => {
    const preparation = connector.preparation
    if (preparation === undefined) return
    entry.queued = key
    enqueue(botId, async () => {
      if (closed || entry.queued !== key) return
      const controller = new AbortController()
      const job: Job = { key, controller }
      entry.running = job
      const current = () => !closed && entry.running === job && !controller.signal.aborted
      try {
        const context = deps.context(botId, connector, controller.signal)
        if (context === undefined) return
        set(botId, connector.id, entry, preparing(entry, { kind: "running", since: deps.now() }))
        await preparation.prepare(context, (step) => {
          if (!current() || entry.readiness.state !== "preparing") return
          set(
            botId,
            connector.id,
            entry,
            preparing(entry, { kind: "running", step, since: deps.now() }),
          )
        })
        if (!current()) return
        entry.prepared = key
        entry.started = true
        entry.failures = 0
        set(botId, connector.id, entry, { state: "ready", since: deps.now() })
      } catch (error) {
        if (!current()) return
        entry.started = true
        entry.failures += 1
        const delay = Math.min(retryMs * 2 ** (entry.failures - 1), maxRetryMs)
        const reason = messageOf(error)
        const at = deps.now()
        deps.warn(
          `bot-core: connector "${connector.id}" could not be prepared for bot "${botId}" (retrying in ${Math.round(delay / 1000)} s): ${reason}`,
        )
        entry.failedKey = key
        entry.cancelRetry = deps.later(delay, () => {
          entry.cancelRetry = undefined
          entry.failedKey = undefined
          evaluate(botId, connector.id)
        })
        set(botId, connector.id, entry, { state: "failed", reason, at, retryAt: at + delay })
      } finally {
        if (entry.running === job) entry.running = undefined
        if (entry.queued === key) entry.queued = undefined
        if (!closed) evaluate(botId, connector.id)
      }
    })
  }

  const evaluate = (botId: string, connectorId: string) => {
    if (closed) return
    const connector = deps.catalog.get(connectorId)
    const entry = entryOf(botId, connectorId)
    const view = wanted(botId, connector)
    if (connector === undefined || view === undefined) {
      abort(entry)
      cancelRetry(entry)
      entry.queued = undefined
      entry.prepared = undefined
      entry.failures = 0
      if (entry.started && connector !== undefined) unprepare(botId, connector)
      entry.started = false
      set(botId, connectorId, entry, DISABLED)
      if (!deps.exists(botId)) entries.delete(keyOf(botId, connectorId))
      return
    }
    const missing = deps.accounts(botId, connector)
    if (missing !== undefined) {
      set(botId, connectorId, entry, {
        state: "unavailable",
        cause: "accounts",
        reason: missing,
      })
      return
    }
    const environment = needsEnvironment(connector) ? deps.environment(botId) : undefined
    if (environment?.ready === false) {
      halt(entry)
      set(botId, connectorId, entry, {
        state: "unavailable",
        cause: "environment",
        reason: environment.reason,
      })
      return
    }
    const requirement = requirementState(connector, {
      get: (id) => deps.catalog.get(id),
      readiness: (id) => stateOf(botId, id),
    })
    if (requirement.kind === "unavailable") {
      halt(entry)
      set(botId, connectorId, entry, {
        state: "unavailable",
        cause: "requirements",
        reason: requirement.reason,
      })
      return
    }
    const generation = environment?.generation ?? ""
    if (requirement.kind === "waiting") {
      halt(entry)
      set(
        botId,
        connectorId,
        entry,
        preparing(entry, {
          kind: "requirements",
          connectors: requirement.connectors,
          since: deps.now(),
        }),
      )
      return
    }
    if (connector.preparation === undefined) {
      set(botId, connectorId, entry, ready(entry))
      return
    }
    const key = `${generation}\u0000${canonicalJson(view.values)}\u0000${requirement.key}`
    if (entry.prepared === key) {
      set(botId, connectorId, entry, ready(entry))
      return
    }
    if (entry.queued === key || entry.failedKey === key) return
    abort(entry)
    cancelRetry(entry)
    entry.prepared = undefined
    set(botId, connectorId, entry, preparing(entry, { kind: "queued", since: deps.now() }))
    prepare(botId, connector, entry, key)
  }

  const botsOf = () => new Set([...entries.keys()].map((key) => key.split("\u0000")[0] as string))

  return {
    state(botId, connectorId) {
      if (deps.catalog.get(connectorId) === undefined) return DISABLED
      return entries.get(keyOf(botId, connectorId))?.readiness ?? DISABLED
    },
    sync(botId) {
      const bots = botId === undefined ? new Set([...deps.bots(), ...botsOf()]) : new Set([botId])
      const connectors = deps.catalog.list().map((connector) => connector.id)
      for (const bot of bots) {
        const ids = new Set([
          ...connectors,
          ...[...entries.keys()]
            .filter((key) => key.startsWith(`${bot}\u0000`))
            .map((key) => key.slice(bot.length + 1)),
        ])
        for (const connectorId of ids) evaluate(bot, connectorId)
      }
    },
    retry(botId, connectorId) {
      const entry = entries.get(keyOf(botId, connectorId))
      if (closed || entry === undefined || entry.readiness.state !== "failed") return
      cancelRetry(entry)
      entry.failures = 0
      evaluate(botId, connectorId)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      if (closed) return
      closed = true
      for (const entry of entries.values()) {
        abort(entry)
        cancelRetry(entry)
      }
      listeners.clear()
    },
  }
}
