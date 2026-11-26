import {
  type BotConnectorsSnapshot,
  type BotConnectorView,
  type ConnectorDescriptor,
  connectorToolName,
  parseConnectorChange,
} from "../../shared/connectors"
import type { BotEnvironmentSpec } from "../../shared/environment"
import type { ConnectorAccounts } from "../connections/accounts"
import type { CatalogConnector, ConnectorCatalog } from "./catalog"
import { permissionChangeSchema } from "./domain"
import type { ConnectorPermissions } from "./permissions"
import type { ConnectorReadinessKeeper } from "./readiness"
import type { ConnectorSettings } from "./settings"
import type { ConnectorStatuses } from "./statuses"

export interface ConnectorPanelDeps {
  catalog: Pick<ConnectorCatalog, "list" | "get" | "subscribe">
  settings: Pick<ConnectorSettings, "view" | "configure" | "subscribe">
  readiness: Pick<ConnectorReadinessKeeper, "state" | "retry" | "subscribe">
  permissions: Pick<ConnectorPermissions, "list" | "set" | "subscribe">
  accounts: Pick<ConnectorAccounts, "of">
  waiting(botId: string, connectorId: string): number
  subscribeAccounts(listener: () => void): () => void
  statuses: Pick<ConnectorStatuses, "read" | "subscribe">
  exists(botId: string): boolean
  spec(botId: string): BotEnvironmentSpec | undefined
  subscribeSpecs(listener: (botId: string) => void): () => void
}

export interface ConnectorPanel {
  views(botId: string): readonly BotConnectorView[]
  snapshot(botId: string): BotConnectorsSnapshot
  configure(botId: string, connectorId: string, change: unknown): Promise<BotConnectorView>
  setPermission(botId: string, change: unknown): Promise<BotConnectorView>
  retry(botId: string, connectorId: string): BotConnectorView
  subscribe(listener: () => void): () => void
}

const issueOf = (error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
}) => {
  const issue = error.issues[0]
  const at = issue?.path.length ? ` at ${issue.path.map(String).join(".")}` : ""
  return `${issue?.message ?? "malformed"}${at}`
}

export function descriptorOf(connector: CatalogConnector): ConnectorDescriptor {
  return {
    id: connector.id,
    name: connector.name,
    ...(connector.description === undefined ? {} : { description: connector.description }),
    sessions: connector.sessions,
    settings: connector.settings ?? [],
    minimumSpec: { ...connector.minimumSpec },
    requires: [...(connector.requires ?? [])],
    ...(connector.preparation === undefined
      ? {}
      : {
          preparation:
            connector.preparation.hint === undefined ? {} : { hint: connector.preparation.hint },
        }),
    tools: connector.tools.map((tool) => ({
      name: tool.name,
      toolName: connectorToolName(connector.id, tool.name),
      description: tool.description,
      permission: tool.permission,
    })),
    ...(connector.connections === undefined
      ? {}
      : {
          connections: {
            provider: connector.connections.provider,
            scopes: [...connector.connections.scopes],
          },
        }),
    ...(connector.events === undefined
      ? {}
      : {
          events: {
            kinds: connector.events.kinds.map((kind) => ({ kind: kind.kind, label: kind.label })),
            delivery: connector.events.delivery,
            intervalMs: connector.events.intervalMs,
          },
        }),
    ...(connector.panel === undefined
      ? {}
      : {
          panel: {
            title: connector.panel.title,
            icon: connector.panel.icon,
            presentation: connector.panel.presentation,
            streams: connector.panel.streams.map((stream) => stream.name),
          },
        }),
  }
}

export function createConnectorPanel(deps: ConnectorPanelDeps): ConnectorPanel {
  const requireBot = (botId: string) => {
    if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
  }
  const requireConnector = (connectorId: string) => {
    const connector = deps.catalog.get(connectorId)
    if (connector === undefined) throw new Error(`connector "${connectorId}" is not registered`)
    return connector
  }
  const accountIds = (botId: string) => (connectorId: string) => {
    const connector = deps.catalog.get(connectorId)
    return connector === undefined
      ? undefined
      : deps.accounts.of(botId, connector).map((account) => account.connectionId)
  }
  const view = (botId: string, connector: CatalogConnector): BotConnectorView => {
    const { enabled, values, events } = deps.settings.view(botId, connector)
    return {
      connector: descriptorOf(connector),
      enabled,
      values,
      readiness: deps.readiness.state(botId, connector.id),
      permissions: deps.permissions
        .list(botId, accountIds(botId))
        .filter((entry) => entry.connectorId === connector.id),
      status: deps.statuses.read(botId, connector),
      ...(connector.connections === undefined
        ? {}
        : { accounts: deps.accounts.of(botId, connector) }),
      ...(events === undefined
        ? {}
        : { events: { delivery: events, waiting: deps.waiting(botId, connector.id) } }),
    }
  }
  const views = (botId: string) => {
    requireBot(botId)
    return deps.catalog.list().map((connector) => view(botId, connector))
  }
  return {
    views,
    snapshot(botId) {
      const connectors = views(botId)
      const spec = deps.spec(botId)
      return { botId, connectors, ...(spec === undefined ? {} : { spec }) }
    },
    async configure(botId, connectorId, input) {
      requireBot(botId)
      const connector = requireConnector(connectorId)
      const change = parseConnectorChange(
        { settings: connector.settings ?? [], events: connector.events !== undefined },
        input,
      )
      await deps.settings.configure(botId, connector, change)
      return view(botId, connector)
    },
    async setPermission(botId, input) {
      requireBot(botId)
      const parsed = permissionChangeSchema.safeParse(input)
      if (!parsed.success) throw new Error(`invalid permission change: ${issueOf(parsed.error)}`)
      const connector = requireConnector(parsed.data.connectorId)
      const { connectionId } = parsed.data
      if (
        connectionId !== undefined &&
        !deps.accounts.of(botId, connector).some((account) => account.connectionId === connectionId)
      ) {
        throw new Error("that account is not assigned to this bot")
      }
      await deps.permissions.set(botId, parsed.data)
      return view(botId, connector)
    },
    retry(botId, connectorId) {
      requireBot(botId)
      const connector = requireConnector(connectorId)
      deps.readiness.retry(botId, connectorId)
      return view(botId, connector)
    },
    subscribe(listener) {
      const offs = [
        deps.catalog.subscribe(listener),
        deps.settings.subscribe(() => listener()),
        deps.readiness.subscribe(() => listener()),
        deps.permissions.subscribe(() => listener()),
        deps.subscribeAccounts(listener),
        deps.statuses.subscribe(() => listener()),
        deps.subscribeSpecs(() => listener()),
      ]
      return () => {
        for (const off of offs) off()
      }
    },
  }
}
