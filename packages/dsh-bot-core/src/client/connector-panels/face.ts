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

export interface ConnectorPanelsFace {
  readonly connectors: ConnectorsHub
  readonly places: ConnectorPanelPlaces
  readonly width: PanelWidth
  text(value: ConnectorText): string
  readonly openStream: OpenConnectorStream
}
