import type { BotConnectorView, ConnectorJson } from "./shared/connectors"

export type ConnectorPanelSlot = "bot-core.connector.panel"

export interface ConnectorPanelProps {
  readonly botId: string
  readonly sessionId: string
  readonly connector: BotConnectorView
  readonly frame: ConnectorPanelFrame
  readonly openStream: (name: string) => ConnectorPanelStream
}

export type ConnectorPanelFrame =
  | { readonly presentation: "side" }
  | { readonly presentation: "popover"; readonly bounds: ConnectorPanelBounds }

export interface ConnectorPanelBounds {
  readonly width: string
  readonly height: string
}

export interface ConnectorPanelStream extends AsyncIterable<ConnectorJson> {
  send(item: ConnectorJson): void
  end(): void
  dispose(): void
}
