import type { ConnectorPanelsFace } from "../connector-panels/face"
import { connectorPanelPlaces } from "../connector-panels/places"
import { openConnectorStream } from "../connector-panels/stream"
import type { ConnectorsHub } from "../connectors-hub"
import { CONNECTOR_PANEL_WIDTH, createPanelWidth } from "../files/panel-width"
import type { RemoteMount } from "../remote"
import type { ClientContext } from "../types"
import type { ShellPanels } from "./panels"

export interface ConnectorPanelsSources {
  readonly remote: Promise<RemoteMount>
  readonly connectors: ConnectorsHub
  readonly surfaces: ShellPanels
}

/** Connectors' panels in the bot shell: where they show, their width and streams. */
export function wireConnectorPanels(
  ctx: ClientContext,
  sources: ConnectorPanelsSources,
): ConnectorPanelsFace {
  return {
    connectors: sources.connectors,
    places: connectorPanelPlaces(sources.surfaces),
    width: createPanelWidth(CONNECTOR_PANEL_WIDTH),
    text: (value) => ctx.locale.resolveText({ ...value }),
    openStream: (botId, connectorId, name) =>
      openConnectorStream(sources.remote, botId, connectorId, name),
  }
}
