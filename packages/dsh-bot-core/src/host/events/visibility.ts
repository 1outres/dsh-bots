import { type ConnectorSender, judgeSender, type SenderPolicy } from "../../shared/senders"
import type { EventRecord } from "./domain"
import type { EventStore } from "./store"

export interface EventVisibilityDeps {
  screened(connectorId: string): boolean
  policy(connectionId: string): SenderPolicy | undefined
}

const UNREADABLE: ConnectorSender = { kind: "anonymous" }

export function eventVisible(deps: EventVisibilityDeps, record: EventRecord): boolean {
  if (record.gap || !deps.screened(record.connectorId)) return true
  const policy = deps.policy(record.connectionId)
  if (policy === undefined) return false
  return judgeSender(policy, record.sender ?? UNREADABLE).visible
}

export type VisibleEvents = Pick<
  EventStore,
  "unread" | "unreadStreams" | "notified" | "acknowledge" | "subscribe"
>

export function visibleEvents(store: VisibleEvents, deps: EventVisibilityDeps): VisibleEvents {
  const unread = (botId: string, connectorId: string) =>
    store.unread(botId, connectorId).filter((record) => eventVisible(deps, record))
  return {
    unread,
    unreadStreams: () =>
      store
        .unreadStreams()
        .filter(({ botId, connectorId }) => unread(botId, connectorId).length > 0),
    notified: (ids) => store.notified(ids),
    acknowledge(botId, connectorId, ids) {
      const visible = new Set(unread(botId, connectorId).map((record) => record.id))
      return store.acknowledge(
        botId,
        connectorId,
        ids.filter((id) => visible.has(id)),
      )
    },
    subscribe: (listener) => store.subscribe(listener),
  }
}
