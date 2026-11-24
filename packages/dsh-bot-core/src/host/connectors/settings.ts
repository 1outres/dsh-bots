import type { ConnectorEventDelivery } from "../../shared/connections"
import {
  type BotConnectorChange,
  type ConnectorSettingValues,
  type ConnectorSwitchSubject,
  connectorSettingValuesOf,
  connectorSwitchBlock,
  connectorSwitchRefusal,
} from "../../shared/connectors"
import type { BotEnvironmentSpec } from "../../shared/environment"
import type { BotTable } from "../registry"
import type { SaveQueue } from "../save-queue"
import type { CatalogConnector, ConnectorCatalog } from "./catalog"
import { type SettingsRecord, settingsRecordKey } from "./domain"

export interface ConnectorSettingsDeps {
  /** The settings table of CONNECTORS_DOMAIN. */
  records: BotTable<SettingsRecord>
  catalog: Pick<ConnectorCatalog, "get" | "list">
  /** The queue the bot's environment spec is saved in, so neither check races the other. */
  queue: SaveQueue
  /** The bot's environment spec, read inside the queue; undefined until it is read. */
  spec(botId: string): BotEnvironmentSpec | undefined
  now(): number
}

/** A bot's settings of one connector: whether it is on, and every field's value. */
export interface ConnectorSettingsView {
  readonly enabled: boolean
  readonly values: ConnectorSettingValues
  /** The stored delivery of a connector with events. */
  readonly events?: ConnectorEventDelivery
}

/** Which bots have which connectors enabled, and with which settings. A connector is off until enabled. */
export interface ConnectorSettings {
  view(botId: string, connector: CatalogConnector): ConnectorSettingsView
  /** Whether the connector is registered and enabled for the bot. */
  enabled(botId: string, connectorId: string): boolean
  /** How the bot gets the connector's events: `off` unless it is enabled, has events, and the bot turned them on. */
  delivery(botId: string, connectorId: string): ConnectorEventDelivery
  /**
   * Store a parsed change. Saves never interleave.
   * @throws when it turns the connector on before one it requires or while the bot's spec has less than its `minimumSpec`, or off before one requiring it (`connectorSwitchBlock`).
   */
  configure(botId: string, connector: CatalogConnector, change: BotConnectorChange): Promise<void>
  /** Forget the settings of bots `keep` refuses. */
  purge(keep: (botId: string) => boolean): Promise<void>
  /** Called with the bot and connector after every stored change. */
  subscribe(listener: (botId: string, connectorId: string) => void): () => void
}

export function createConnectorSettings(deps: ConnectorSettingsDeps): ConnectorSettings {
  const listeners = new Set<(botId: string, connectorId: string) => void>()
  const serial = deps.queue
  const changed = (botId: string, connectorId: string) => {
    for (const listener of [...listeners]) listener(botId, connectorId)
  }
  const recordOf = (botId: string, connectorId: string) =>
    deps.records.get(settingsRecordKey(botId, connectorId))
  const subjectOf = (botId: string, connector: CatalogConnector): ConnectorSwitchSubject => ({
    id: connector.id,
    name: connector.name,
    requires: connector.requires ?? [],
    minimumSpec: connector.minimumSpec ?? {},
    enabled: recordOf(botId, connector.id)?.enabled === true,
  })
  const admit = (botId: string, connector: CatalogConnector, enabled: boolean) => {
    const block = connectorSwitchBlock(
      subjectOf(botId, connector),
      deps.catalog.list().map((entry) => subjectOf(botId, entry)),
      enabled,
      deps.spec(botId),
    )
    if (block !== undefined) throw new Error(connectorSwitchRefusal(connector.name, block))
  }

  return {
    view(botId, connector) {
      const record = recordOf(botId, connector.id)
      return {
        enabled: record?.enabled ?? false,
        values: connectorSettingValuesOf(connector.settings ?? [], record?.values ?? {}),
        ...(connector.events === undefined ? {} : { events: record?.events ?? "off" }),
      }
    },
    enabled: (botId, connectorId) =>
      deps.catalog.get(connectorId) !== undefined && recordOf(botId, connectorId)?.enabled === true,
    delivery(botId, connectorId) {
      const record = recordOf(botId, connectorId)
      if (deps.catalog.get(connectorId)?.events === undefined || record?.enabled !== true)
        return "off"
      return record.events ?? "off"
    },
    configure(botId, connector, change) {
      return serial(async () => {
        admit(botId, connector, change.enabled)
        await deps.records.put(settingsRecordKey(botId, connector.id), {
          botId,
          connectorId: connector.id,
          enabled: change.enabled,
          values: { ...connectorSettingValuesOf(connector.settings ?? [], change.values) },
          ...(change.events === undefined ? {} : { events: change.events }),
          updatedAt: deps.now(),
        })
        changed(botId, connector.id)
      })
    },
    purge(keep) {
      return serial(async () => {
        for (const [key, record] of [...deps.records.entries()]) {
          if (keep(record.botId)) continue
          await deps.records.delete(key)
          changed(record.botId, record.connectorId)
        }
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
