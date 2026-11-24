/**
 * bot-core's own tools of a connector: `<connector>_accounts` for one with
 * connections, `<connector>_events_list` / `_events_ack` for one whose
 * events a bot gets in a queue.
 */
import type { ConnectorAccounts } from "../connections/accounts"
import type { ConnectorCatalog } from "../connectors/catalog"
import type { ConnectorToolReply } from "../connectors/texts"
import { MAX_EVENTS_LISTED } from "../connectors/tools"
import { groupEvents } from "./delivery"
import type { EventStore } from "./store"
import { eventAckReply, eventListReply } from "./texts"

export interface ConnectorOwnToolsDeps {
  catalog: Pick<ConnectorCatalog, "get">
  accounts: Pick<ConnectorAccounts, "list" | "resolve">
  store: Pick<EventStore, "unread" | "acknowledge">
  /** How an account is named in the bot's text. */
  account(connectionId: string): string
  newNonce(): string
}

export interface ConnectorOwnTools {
  accounts(botId: string, connectorId: string): ConnectorToolReply
  /** @throws when the arguments are not valid. */
  eventsList(botId: string, connectorId: string, args: unknown): ConnectorToolReply
  /** @throws when the arguments are not valid. */
  eventsAck(botId: string, connectorId: string, args: unknown): Promise<ConnectorToolReply>
}

const MAX_ACK = 500

export function createConnectorOwnTools(deps: ConnectorOwnToolsDeps): ConnectorOwnTools {
  const connectorOf = (connectorId: string) => {
    const connector = deps.catalog.get(connectorId)
    if (connector === undefined) throw new Error(`connector "${connectorId}" is not registered now`)
    return connector
  }
  return {
    accounts(botId, connectorId) {
      return deps.accounts.list(botId, connectorOf(connectorId))
    },
    eventsList(botId, connectorId, input) {
      const connector = connectorOf(connectorId)
      const args = (typeof input === "object" && input !== null ? input : {}) as {
        readonly account?: unknown
        readonly limit?: unknown
      }
      let limit = MAX_EVENTS_LISTED
      if (args.limit !== undefined) {
        if (
          !Number.isSafeInteger(args.limit) ||
          (args.limit as number) < 1 ||
          (args.limit as number) > MAX_EVENTS_LISTED
        ) {
          throw new Error(`limit must be an integer from 1 to ${MAX_EVENTS_LISTED}`)
        }
        limit = args.limit as number
      }
      let events = deps.store.unread(botId, connectorId)
      if (args.account !== undefined) {
        if (typeof args.account !== "string") throw new Error("account must be text")
        const resolved = deps.accounts.resolve(botId, connector, args.account)
        if (!resolved.ok) throw new Error(resolved.reason)
        events = events.filter((event) => event.connectionId === resolved.connection.id)
      }
      const shown = events.slice(0, limit)
      const reply = eventListReply(
        groupEvents(shown, { id: connector.id, name: connector.name }, deps.account),
        deps.newNonce(),
      )
      const more = events.length - shown.length
      return more === 0
        ? reply
        : {
            ...reply,
            text: `${reply.text}\n\n${more} more event(s) wait; acknowledge these to list them.`,
          }
    },
    async eventsAck(botId, connectorId, input) {
      connectorOf(connectorId)
      const ids = (input as { readonly event_ids?: unknown } | null)?.event_ids
      if (
        !Array.isArray(ids) ||
        ids.length === 0 ||
        ids.length > MAX_ACK ||
        ids.some((id) => typeof id !== "string")
      ) {
        throw new Error(`event_ids must list 1 to ${MAX_ACK} event ids`)
      }
      const asked = [...new Set(ids as string[])]
      const acked = await deps.store.acknowledge(botId, connectorId, asked)
      return eventAckReply(acked, asked)
    },
  }
}
