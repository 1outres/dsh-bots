import type { ConnectorPanelStream } from "../../connector-panel-contract"
import type { ConnectorText } from "../../shared/connectors"
import type { ConnectorsHub } from "../connectors-hub"
import type { PanelWidth } from "../files/panel-width"
import type { ConnectorPanelPlaces } from "./places"

export type OpenConnectorStream = (
  botId: string,
  connectorId: string,
  name: string,
) => ConnectorPanelStream

/** What the bot shell needs for connectors' panels. */
export interface ConnectorPanelsFace {
  readonly connectors: ConnectorsHub
  /** Where each presentation shows a connector's panel. */
  readonly places: ConnectorPanelPlaces
  /** The width of the side panels. */
  readonly width: PanelWidth
  /** A connector's text in the page's language. */
  text(value: ConnectorText): string
  readonly openStream: OpenConnectorStream
}
