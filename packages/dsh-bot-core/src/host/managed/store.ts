import type { BotManagedSession } from "../../shared/managed-sessions"
import type { BotTable } from "../registry"
import type { ManagedSessionRecord } from "./domain"

export interface ManagedStoreDeps {
  readonly managedSessions: BotTable<ManagedSessionRecord>
}

export interface ManagedStore {
  list(botId?: string): BotManagedSession[]
  get(sessionId: string): BotManagedSession | undefined
  put(sessionId: string, record: ManagedSessionRecord): Promise<BotManagedSession>
  delete(sessionId: string): Promise<boolean>
  purge(keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: () => void): () => void
}

const viewOf = (sessionId: string, record: ManagedSessionRecord): BotManagedSession => ({
  ...record,
  sessionId,
})

export function createManagedStore(deps: ManagedStoreDeps): ManagedStore {
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }

  return {
    list: (botId) =>
      [...deps.managedSessions.entries()]
        .map(([sessionId, record]) => viewOf(sessionId, record))
        .filter((session) => botId === undefined || session.botId === botId)
        .sort((a, b) => a.since - b.since || a.sessionId.localeCompare(b.sessionId)),
    get(sessionId) {
      const record = deps.managedSessions.get(sessionId)
      return record === undefined ? undefined : viewOf(sessionId, record)
    },
    put: (sessionId, record) =>
      serial(async () => {
        await deps.managedSessions.put(sessionId, record)
        publish()
        return viewOf(sessionId, record)
      }),
    delete: (sessionId) =>
      serial(async () => {
        if (deps.managedSessions.get(sessionId) === undefined) return false
        await deps.managedSessions.delete(sessionId)
        publish()
        return true
      }),
    purge: (keep) =>
      serial(async () => {
        let changed = false
        for (const [sessionId, record] of [...deps.managedSessions.entries()]) {
          if (keep(record.botId)) continue
          await deps.managedSessions.delete(sessionId)
          changed = true
        }
        if (changed) publish()
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
