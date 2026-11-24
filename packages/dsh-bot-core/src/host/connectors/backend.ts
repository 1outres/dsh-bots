import type { BotConnectorsBackend } from "../../service"
import type { ConnectorJson } from "../../shared/connectors"
import type { ConnectorOwnTools } from "../events/tools"
import type { ConnectorBroker } from "./broker"
import type { ConnectorCatalog } from "./catalog"
import { permissionChangeSchema } from "./domain"
import type { ConnectorLedger } from "./ledger"
import type { ConnectorPanel } from "./panel"
import type { ConnectorPermissions } from "./permissions"
import type { ConnectorReadinessKeeper } from "./readiness"
import type { ConnectorSettings } from "./settings"
import type { ConnectorStatuses } from "./statuses"
import type { ConnectorToolSurface } from "./tools"

/** Who calls a bot's connector tool, as bot-core classified the Agent. */
export type ConnectorCaller =
  | { readonly kind: "main" | "bot"; readonly sessionId: string }
  | { readonly kind: "refused"; readonly reason: string }

export interface ConnectorsBackendDeps {
  catalog: ConnectorCatalog
  permissions: ConnectorPermissions
  settings: Pick<ConnectorSettings, "subscribe">
  readiness: Pick<ConnectorReadinessKeeper, "subscribe">
  statuses: Pick<ConnectorStatuses, "subscribe">
  ledger: ConnectorLedger
  broker: ConnectorBroker
  surface: ConnectorToolSurface
  panel: ConnectorPanel
  own: ConnectorOwnTools
  exists(botId: string): boolean
  /**
   * The calling Agent: refused unless `token` is the bot's registered preset
   * revision's and the Agent is a session of the bot; `main` for its Main session.
   */
  caller(botId: string, token: string, agentId: string): ConnectorCaller
}

const issueOf = (error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[]
}) => {
  const issue = error.issues[0]
  const at = issue?.path.length ? ` at ${issue.path.map(String).join(".")}` : ""
  return `${issue?.message ?? "malformed"}${at}`
}

const MAIN_ONLY =
  "works only in the bot's Main session, the conversation its channels are connected to (not in other sessions or subagents)"

/** The `bot` service's connector methods, over the catalog, settings, readiness, permissions, ledger and broker. */
export function createConnectorsBackend(deps: ConnectorsBackendDeps): BotConnectorsBackend {
  const requireBot = (botId: string) => {
    if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
  }
  const visibleTo = (botId: string, name: string, kind: "main" | "bot") => {
    const spec = deps.surface.tools(botId).find((tool) => tool.name === name)
    return spec !== undefined && (spec.sessions === "bot" || kind === "main")
  }
  return {
    register: (connector) => deps.catalog.register(connector),
    list: () => deps.catalog.list(),
    states: (botId) => deps.panel.views(botId),
    async configure(botId, connectorId, change) {
      return deps.panel.configure(botId, connectorId, change)
    },
    retry: (botId, connectorId) => deps.panel.retry(botId, connectorId),
    onStateChange(listener) {
      const offs = [
        deps.settings.subscribe((botId) => listener(botId)),
        deps.readiness.subscribe((botId) => listener(botId)),
        deps.permissions.subscribe((botId) => listener(botId)),
        deps.statuses.subscribe((botId) => listener(botId)),
      ]
      return () => {
        for (const off of offs) off()
      }
    },
    permissions(botId) {
      requireBot(botId)
      return deps.permissions.list(botId)
    },
    async setPermission(botId, change) {
      requireBot(botId)
      const parsed = permissionChangeSchema.safeParse(change)
      if (!parsed.success) throw new Error(`invalid permission change: ${issueOf(parsed.error)}`)
      await deps.permissions.set(botId, parsed.data)
      return deps.permissions.list(botId)
    },
    actions(botId) {
      requireBot(botId)
      return deps.ledger.list(botId)
    },
    subscribe: (listener) => deps.ledger.subscribe(listener),
    watchTools: (botId, _token, listener) => deps.surface.watch(botId, listener),
    toolAvailable(botId, token, agentId, name) {
      const caller = deps.caller(botId, token, agentId)
      return caller.kind !== "refused" && visibleTo(botId, name, caller.kind)
    },
    async callTool(botId, token, request, signal) {
      const caller = deps.caller(botId, token, request.agentId)
      if (caller.kind === "refused") throw new Error(caller.reason)
      const route = deps.surface.route(botId, request.name)
      if (route === undefined) throw new Error(`${request.name} is not available to this bot now`)
      if (!visibleTo(botId, request.name, caller.kind))
        throw new Error(`${request.name} ${MAIN_ONLY}`)
      switch (route.kind) {
        case "pending-list":
          return deps.broker.pending(botId)
        case "pending-cancel": {
          const actionId = (request.args as { readonly action_id?: unknown }).action_id
          if (typeof actionId !== "string") throw new Error("action_id must be an action id")
          return deps.broker.cancel(botId, actionId)
        }
        case "accounts":
          return deps.own.accounts(botId, route.connectorId)
        case "events-list":
          return deps.own.eventsList(botId, route.connectorId, request.args)
        case "events-ack":
          return deps.own.eventsAck(botId, route.connectorId, request.args)
        case "connector":
          return deps.broker.call(
            {
              botId,
              sessionId: caller.sessionId,
              connectorId: route.connectorId,
              tool: route.tool,
              args: request.args as ConnectorJson,
            },
            signal,
          )
      }
    },
  }
}
