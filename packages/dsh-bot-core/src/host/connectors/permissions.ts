import type {
  ConnectorPermission,
  ConnectorPermissionChange,
  ConnectorToolPermission,
} from "../../shared/connectors"
import type { BotTable } from "../registry"
import type { ConnectorCatalog } from "./catalog"
import { type PermissionRecord, permissionRecordKey } from "./domain"

export interface ConnectorPermissionsDeps {
  records: BotTable<PermissionRecord>
  catalog: Pick<ConnectorCatalog, "tools" | "tool">
  now(): number
}

export interface ConnectorPermissions {
  effective(
    botId: string,
    connectorId: string,
    tool: string,
    connectionId?: string,
  ): ConnectorPermission | undefined
  list(
    botId: string,
    accounts?: (connectorId: string) => readonly string[] | undefined,
  ): readonly ConnectorToolPermission[]
  set(botId: string, change: ConnectorPermissionChange): Promise<void>
  purge(
    keep: (botId: string) => boolean,
    keepAccount?: (botId: string, connectionId: string) => boolean,
  ): Promise<void>
  subscribe(listener: (botId: string) => void): () => void
}

export function createConnectorPermissions(deps: ConnectorPermissionsDeps): ConnectorPermissions {
  const listeners = new Set<(botId: string) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const changed = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  const override = (botId: string, connectorId: string, tool: string, connectionId?: string) =>
    deps.records.get(permissionRecordKey(botId, connectorId, tool, connectionId))?.permission

  return {
    effective(botId, connectorId, tool, connectionId) {
      const entry = deps.catalog.tool(connectorId, tool)
      if (entry === undefined) return undefined
      return (
        (connectionId === undefined
          ? undefined
          : override(botId, connectorId, tool, connectionId)) ??
        override(botId, connectorId, tool) ??
        entry.tool.permission
      )
    },
    list(botId, accounts) {
      return deps.catalog.tools().map((entry) => {
        const connectorId = entry.connector.id
        const own = override(botId, connectorId, entry.tool.name)
        const effective = own ?? entry.tool.permission
        const connections =
          entry.connector.connections === undefined ? undefined : (accounts?.(connectorId) ?? [])
        return {
          connectorId,
          tool: entry.tool.name,
          default: entry.tool.permission,
          ...(own === undefined ? {} : { override: own }),
          effective,
          ...(connections === undefined
            ? {}
            : {
                accounts: connections.map((connectionId) => {
                  const account = override(botId, connectorId, entry.tool.name, connectionId)
                  return {
                    connectionId,
                    ...(account === undefined ? {} : { override: account }),
                    effective: account ?? effective,
                  }
                }),
              }),
        }
      })
    },
    set(botId, change) {
      return serial(async () => {
        const entry = deps.catalog.tool(change.connectorId, change.tool)
        if (entry === undefined) {
          throw new Error(
            `no registered connector has tool "${change.tool}" of "${change.connectorId}"`,
          )
        }
        if (change.connectionId !== undefined && entry.connector.connections === undefined) {
          throw new Error(`${entry.name} acts as no account, so it has no permission per account`)
        }
        const key = permissionRecordKey(botId, change.connectorId, change.tool, change.connectionId)
        if (change.permission === null) {
          await deps.records.delete(key)
        } else {
          await deps.records.put(key, {
            botId,
            connectorId: change.connectorId,
            tool: change.tool,
            ...(change.connectionId === undefined ? {} : { connectionId: change.connectionId }),
            permission: change.permission,
            updatedAt: deps.now(),
          })
        }
        changed(botId)
      })
    },
    purge(keep, keepAccount) {
      return serial(async () => {
        const gone = new Set<string>()
        for (const [key, record] of [...deps.records.entries()]) {
          const connectionKept =
            record.connectionId === undefined ||
            keepAccount === undefined ||
            keepAccount(record.botId, record.connectionId)
          if (keep(record.botId) && connectionKept) continue
          await deps.records.delete(key)
          gone.add(record.botId)
        }
        for (const botId of gone) changed(botId)
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
