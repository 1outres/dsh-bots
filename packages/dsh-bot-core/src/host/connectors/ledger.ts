import type { ConnectorAction, ConnectorActionChange } from "../../shared/connectors"
import type { BotTable } from "../registry"
import {
  advance,
  type ConnectorActionEvent,
  type ConnectorActionTransition,
  canonicalJson,
  finishedAt,
} from "./action"

export interface ConnectorLedgerDeps {
  actions: BotTable<ConnectorAction>
  warn(message: string): void
}

export type LedgerTransition =
  | { readonly ok: true; readonly action: ConnectorAction; readonly stored: Promise<void> }
  | Extract<ConnectorActionTransition, { ok: false }>

export interface ConnectorLedger {
  get(actionId: string): ConnectorAction | undefined
  list(botId: string): readonly ConnectorAction[]
  all(): readonly ConnectorAction[]
  pendingTwin(
    botId: string,
    connectorId: string,
    tool: string,
    args: ConnectorAction["args"],
    connectionId?: string,
  ): ConnectorAction | undefined
  create(action: ConnectorAction): Promise<void>
  advance(actionId: string, event: ConnectorActionEvent): LedgerTransition | undefined
  prune(before: number, keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: (change: ConnectorActionChange) => void): () => void
}

export function createConnectorLedger(deps: ConnectorLedgerDeps): ConnectorLedger {
  const memory = new Map<string, ConnectorAction>()
  for (const [id, action] of deps.actions.entries()) memory.set(id, action)
  const listeners = new Set<(change: ConnectorActionChange) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = (work: () => Promise<unknown>): Promise<void> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next.then(() => undefined)
  }
  const queue: ConnectorAction[] = []
  let publishing = false
  const publish = (action: ConnectorAction) => {
    queue.push(action)
    if (publishing) return
    publishing = true
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        for (const listener of [...listeners]) listener({ botId: next.botId, action: next })
      }
    } finally {
      publishing = false
    }
  }
  const store = (action: ConnectorAction) => {
    const stored = serial(() => deps.actions.put(action.id, action))
    stored.catch((error: unknown) => {
      deps.warn(
        `bot-core: could not store connector action "${action.id}" (${action.status.state}): ${String(error)}`,
      )
    })
    return stored
  }
  const ordered = (actions: Iterable<ConnectorAction>) =>
    [...actions].sort((a, b) => a.createdAt - b.createdAt)

  return {
    get: (actionId) => memory.get(actionId),
    list: (botId) => ordered([...memory.values()].filter((action) => action.botId === botId)),
    all: () => ordered(memory.values()),
    pendingTwin(botId, connectorId, tool, args, connectionId) {
      const key = canonicalJson(args)
      return ordered(memory.values()).find(
        (action) =>
          action.botId === botId &&
          action.connectorId === connectorId &&
          action.tool === tool &&
          action.connectionId === connectionId &&
          action.status.state === "pending" &&
          canonicalJson(action.args) === key,
      )
    },
    async create(action) {
      if (memory.has(action.id)) throw new Error(`connector action "${action.id}" already exists`)
      memory.set(action.id, action)
      try {
        await store(action)
      } catch (error) {
        if (memory.get(action.id) === action) memory.delete(action.id)
        throw error
      }
      publish(action)
    },
    advance(actionId, event) {
      const current = memory.get(actionId)
      if (current === undefined) return undefined
      const transition = advance(current, event)
      if (!transition.ok) return transition
      memory.set(actionId, transition.action)
      const stored = store(transition.action)
      publish(transition.action)
      return { ok: true, action: transition.action, stored }
    },
    prune(before, keep) {
      const gone = [...memory.values()].filter((action) => {
        if (!keep(action.botId)) return true
        const finished = finishedAt(action)
        return finished !== undefined && finished < before
      })
      for (const action of gone) memory.delete(action.id)
      return serial(async () => {
        for (const action of gone) await deps.actions.delete(action.id)
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
