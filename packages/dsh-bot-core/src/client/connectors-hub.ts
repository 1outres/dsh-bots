import type { ConnectorsModel, ConnectorsState } from "./connectors-model"
import { createFeedHub } from "./feed-hub"
import type { Observable } from "./observable"

/** One bot's connectors, streamed while anything subscribes; changes go through the followed stream. */
export interface ConnectorsFeed
  extends Observable<ConnectorsState>,
    Pick<ConnectorsModel, "configure" | "setPermission" | "retry"> {}

/** Bots' connectors shared by the settings section and its nav badge: one stream per bot. */
export interface ConnectorsHub {
  feed(botId: string): ConnectorsFeed
}

export function createConnectorsHub(open: (botId: string) => ConnectorsModel): ConnectorsHub {
  return createFeedHub<
    ConnectorsState,
    ConnectorsModel,
    Pick<ConnectorsFeed, "configure" | "setPermission" | "retry">
  >({
    name: "connectors",
    idle: { status: "loading" },
    open,
    extend: (followed) => ({
      configure: async (connectorId, change) => followed().configure(connectorId, change),
      setPermission: async (change) => followed().setPermission(change),
      retry: async (connectorId) => followed().retry(connectorId),
    }),
  })
}
