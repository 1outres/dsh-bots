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
  records: BotTable<SettingsRecord>
  catalog: Pick<ConnectorCatalog, "get" | "list">
  queue: SaveQueue
  spec(botId: string): BotEnvironmentSpec | undefined
  now(): number
}

export interface ConnectorSettingsView {
  readonly enabled: boolean
  readonly values: ConnectorSettingValues
  readonly events?: ConnectorEventDelivery
}

export interface ConnectorSettings {
  migrateDeliveries(): Promise<void>
  view(botId: string, connector: CatalogConnector): ConnectorSettingsView
  enabled(botId: string, connectorId: string): boolean
  delivery(botId: string, connectorId: string): ConnectorEventDelivery
  configure(botId: string, connector: CatalogConnector, change: BotConnectorChange): Promise<void>
  purge(keep: (botId: string) => boolean): Promise<void>
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
  const deliveryOf = (record: SettingsRecord): ConnectorEventDelivery => {
    if (record.events === undefined) {
      throw new Error(
        `the settings of connector "${record.connectorId}" of bot "${record.botId}" have no event delivery: migrateDeliveries() did not run`,
      )
    }
    return record.events
  }
  const initialDelivery = (connector: CatalogConnector): ConnectorEventDelivery =>
    connector.events?.delivery ?? "off"
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
    migrateDeliveries() {
      return serial(async () => {
        for (const [key, record] of [...deps.records.entries()]) {
          if (record.events !== undefined) continue
          await deps.records.put(key, { ...record, events: "off" })
        }
      })
    },
    view(botId, connector) {
      const record = recordOf(botId, connector.id)
      return {
        enabled: record?.enabled ?? false,
        values: connectorSettingValuesOf(connector.settings ?? [], record?.values ?? {}),
        ...(connector.events === undefined
          ? {}
          : { events: record === undefined ? initialDelivery(connector) : deliveryOf(record) }),
      }
    },
    enabled: (botId, connectorId) =>
      deps.catalog.get(connectorId) !== undefined && recordOf(botId, connectorId)?.enabled === true,
    delivery(botId, connectorId) {
      const record = recordOf(botId, connectorId)
      if (deps.catalog.get(connectorId)?.events === undefined || record?.enabled !== true)
        return "off"
      return deliveryOf(record)
    },
    configure(botId, connector, change) {
      return serial(async () => {
        admit(botId, connector, change.enabled)
        const record = recordOf(botId, connector.id)
        const events =
          change.events ?? (record === undefined ? initialDelivery(connector) : deliveryOf(record))
        await deps.records.put(settingsRecordKey(botId, connector.id), {
          botId,
          connectorId: connector.id,
          enabled: change.enabled,
          values: { ...connectorSettingValuesOf(connector.settings ?? [], change.values) },
          events,
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
