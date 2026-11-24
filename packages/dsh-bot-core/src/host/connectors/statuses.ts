/**
 * Connectors' statuses per bot (`BotConnector.status`): read from the
 * connector while it is enabled for the bot, followed through every
 * registered connector's source.
 */
import type { ConnectorStatus } from "../../shared/connectors"
import type { CatalogConnector, ConnectorCatalog } from "./catalog"
import type { ConnectorSettings } from "./settings"

export interface ConnectorStatusesDeps {
  catalog: Pick<ConnectorCatalog, "list" | "subscribe">
  settings: Pick<ConnectorSettings, "enabled">
  warn(message: string): void
}

export interface ConnectorStatuses {
  read(botId: string, connector: CatalogConnector): ConnectorStatus
  /** Called with the bot after a connector's status of it changed. */
  subscribe(listener: (botId: string) => void): () => void
  dispose(): void
}

const NONE: ConnectorStatus = {}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createConnectorStatuses(deps: ConnectorStatusesDeps): ConnectorStatuses {
  const listeners = new Set<(botId: string) => void>()
  const followed = new Map<CatalogConnector, () => void>()
  const publish = (botId: string) => {
    for (const listener of [...listeners]) {
      try {
        listener(botId)
      } catch (error) {
        deps.warn(`bot-core: a connector status listener failed: ${messageOf(error)}`)
      }
    }
  }
  const follow = () => {
    const current = new Set(deps.catalog.list())
    for (const [connector, off] of [...followed]) {
      if (current.has(connector)) continue
      off()
      followed.delete(connector)
    }
    for (const connector of current) {
      if (followed.has(connector) || connector.status === undefined) continue
      followed.set(connector, connector.status.subscribe(publish))
    }
  }
  follow()
  const offCatalog = deps.catalog.subscribe(follow)
  return {
    read(botId, connector) {
      if (connector.status === undefined || !deps.settings.enabled(botId, connector.id)) return NONE
      return connector.status.read(botId)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      offCatalog()
      for (const off of followed.values()) off()
      followed.clear()
      listeners.clear()
    },
  }
}
