import type { BotConnectorView, ConnectorJson } from "./shared/connectors"

/**
 * The browser half of a connector's panel (`BotConnector.panel`). bot-core's
 * bot shell owns the panel's place, button, frame and the connector's
 * readiness; once the connector is ready for the bot it renders the keyed
 * Slot {@link ConnectorPanelSlot} with the connector's id as the entry key.
 * A connector's Client plugin registers its body there:
 *
 * ```ts
 * const slot: ConnectorPanelSlot = "bot-core.connector.panel"
 * ctx.slots.inject(slot, () =>
 *   ctx.slots.register({ name: slot, key: "desktop", locale }, DesktopPanel))
 * ```
 *
 * Import only the types of this file (the Slot's key is its literal type).
 */
export type ConnectorPanelSlot = "bot-core.connector.panel"

/** The owner props bot-core gives the body; session-scoped. */
export interface ConnectorPanelProps {
  readonly botId: string
  readonly sessionId: string
  /** The bot's state of the connector, ready while the body is rendered. */
  readonly connector: BotConnectorView
  /** The frame it is drawn in, as the connector's `panel.presentation` asks. */
  readonly frame: ConnectorPanelFrame
  /**
   * Open one of the panel's streams (`BotConnectorPanel.streams`) through
   * bot-core's `botConnectorStreams` Remote. The caller disposes it.
   */
  readonly openStream: (name: string) => ConnectorPanelStream
}

/**
 * A `side` panel's body fills the frame. A `popover` is as large as its
 * body, which sizes itself to its content (a screen's aspect) within
 * `bounds`: CSS lengths of the most room it has, usable in `calc()`.
 */
export type ConnectorPanelFrame =
  | { readonly presentation: "side" }
  | { readonly presentation: "popover"; readonly bounds: ConnectorPanelBounds }

export interface ConnectorPanelBounds {
  readonly width: string
  readonly height: string
}

/** One open panel stream: the Host's items, and the browser's items back. */
export interface ConnectorPanelStream extends AsyncIterable<ConnectorJson> {
  /** Queued until the stream is open. @throws once it ended or was disposed. */
  send(item: ConnectorJson): void
  /** Close the browser's side; the Host's uplink ends. */
  end(): void
  /** Cancel the stream; iteration ends quietly. */
  dispose(): void
}
