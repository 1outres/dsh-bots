import type { ConnectorPanelsFace } from "../connector-panels/face"
import { openConnectorStream } from "../connector-panels/stream"
import type { ConnectorsHub } from "../connectors-hub"
import { CONNECTOR_PANEL_WIDTH, createPanelWidth } from "../files/panel-width"
import type { RemoteMount } from "../remote"
import type { ClientContext } from "../types"

export interface ConnectorPanelsSources {
  readonly remote: Promise<RemoteMount>
  readonly connectors: ConnectorsHub
}

/** Connectors' panels in the bot shell: their width and streams. */
export function wireConnectorPanels(
  ctx: ClientContext,
  sources: ConnectorPanelsSources,
): ConnectorPanelsFace {
  return {
    connectors: sources.connectors,
    width: createPanelWidth(CONNECTOR_PANEL_WIDTH),
    text: (value) => ctx.locale.resolveText({ ...value }),
    openStream: (botId, connectorId, name) =>
      openConnectorStream(sources.remote, botId, connectorId, name),
  }
}
