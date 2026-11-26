import type { ConnectionStatus, ConnectorConnectionInfo } from "../../shared/connections"
import type { BotTable } from "../registry"
import {
  type ClientRecord,
  type ConnectionRecord,
  type GrantRecord,
  grantRecordKey,
} from "./domain"

export function connectionInfo(record: ConnectionRecord): ConnectorConnectionInfo {
  const { issuer: _, ...info } = record
  return info
}

export interface ConnectionStoreDeps {
  connections: BotTable<ConnectionRecord>
  grants: BotTable<GrantRecord>
  clients: BotTable<ClientRecord>
  now(): number
}

export interface ConnectionStore {
  get(connectionId: string): ConnectionRecord | undefined
  list(): readonly ConnectionRecord[]
  byAccount(provider: string, subject: string): ConnectionRecord | undefined
  put(record: ConnectionRecord): Promise<void>
  setStatus(connectionId: string, status: ConnectionStatus, reason?: string): Promise<void>
  rename(connectionId: string, label: string): Promise<ConnectionRecord>
  remove(connectionId: string): Promise<void>
  assigned(botId: string): readonly ConnectionRecord[]
  isAssigned(botId: string, connectionId: string): boolean
  botsOf(connectionId: string): readonly string[]
  assign(botId: string, connectionId: string, assigned: boolean): Promise<void>
  purgeBots(keep: (botId: string) => boolean): Promise<void>
  clientId(provider: string): string | undefined
  setClientId(provider: string, clientId: string | undefined): Promise<void>
  subscribe(listener: () => void): () => void
}

export function createConnectionStore(deps: ConnectionStoreDeps): ConnectionStore {
  const listeners = new Set<() => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const changed = () => {
    for (const listener of [...listeners]) listener()
  }
  const write = async (work: () => Promise<unknown>) => {
    await serial(work)
    changed()
  }
  const all = () =>
    [...deps.connections.entries()]
      .map(([, record]) => record)
      .sort((a, b) => a.createdAt - b.createdAt)
  const grants = () => [...deps.grants.entries()].map(([, record]) => record)
  const require = (connectionId: string) => {
    const record = deps.connections.get(connectionId)
    if (record === undefined) throw new Error(`no connection "${connectionId}"`)
    return record
  }

  return {
    get: (connectionId) => deps.connections.get(connectionId),
    list: all,
    byAccount: (provider, subject) =>
      all().find((record) => record.provider === provider && record.account.subject === subject),
    put: (record) => write(() => deps.connections.put(record.id, record)),
    setStatus(connectionId, status, reason) {
      return write(async () => {
        const record = deps.connections.get(connectionId)
        if (record === undefined) return
        if (record.status === status && record.statusReason === reason) return
        const { statusReason: _, ...rest } = record
        await deps.connections.put(connectionId, {
          ...rest,
          status,
          ...(reason === undefined ? {} : { statusReason: reason }),
        })
      })
    },
    async rename(connectionId, label) {
      let renamed: ConnectionRecord | undefined
      await write(async () => {
        renamed = { ...require(connectionId), label }
        await deps.connections.put(connectionId, renamed)
      })
      return renamed ?? require(connectionId)
    },
    remove(connectionId) {
      return write(async () => {
        for (const grant of grants()) {
          if (grant.connectionId === connectionId) {
            await deps.grants.delete(grantRecordKey(grant.botId, connectionId))
          }
        }
        await deps.connections.delete(connectionId)
      })
    },
    assigned(botId) {
      const ids = new Set(
        grants()
          .filter((grant) => grant.botId === botId)
          .map((grant) => grant.connectionId),
      )
      return all().filter((record) => ids.has(record.id))
    },
    isAssigned: (botId, connectionId) =>
      deps.grants.get(grantRecordKey(botId, connectionId)) !== undefined,
    botsOf: (connectionId) =>
      grants()
        .filter((grant) => grant.connectionId === connectionId)
        .map((grant) => grant.botId),
    assign(botId, connectionId, assigned) {
      return write(async () => {
        require(connectionId)
        const key = grantRecordKey(botId, connectionId)
        if (assigned) {
          if (deps.grants.get(key) !== undefined) return
          await deps.grants.put(key, { botId, connectionId, assignedAt: deps.now() })
        } else {
          await deps.grants.delete(key)
        }
      })
    },
    purgeBots(keep) {
      return write(async () => {
        for (const grant of grants()) {
          if (!keep(grant.botId))
            await deps.grants.delete(grantRecordKey(grant.botId, grant.connectionId))
        }
      })
    },
    clientId: (provider) => deps.clients.get(provider)?.clientId,
    setClientId(provider, clientId) {
      return write(async () => {
        if (clientId === undefined) await deps.clients.delete(provider)
        else await deps.clients.put(provider, { provider, clientId, updatedAt: deps.now() })
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
