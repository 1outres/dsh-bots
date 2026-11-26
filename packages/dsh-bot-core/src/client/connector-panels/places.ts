import type { ConnectorPanelPresentation } from "../../shared/connectors"
import { derive, type Observable } from "../observable"
import { connectorPopover, type ShellPopovers, samePopover } from "../shell/popovers"
import { connectorPanel, type SidePanels, samePanel } from "../shell/side-panels"

/** Where a session shows connectors' panels of one presentation. */
export interface ConnectorPanelPlace {
  shows(sessionId: string, connectorId: string): Observable<boolean>
  open(sessionId: string, connectorId: string): void
  toggle(sessionId: string, connectorId: string): void
}

export type ConnectorPanelPlaces = {
  readonly [Presentation in ConnectorPanelPresentation]: ConnectorPanelPlace
}

export interface ConnectorPanelSurfaces {
  readonly panels: Pick<SidePanels, "open" | "toggle" | "getSnapshot" | "subscribe">
  readonly popovers: Pick<ShellPopovers, "open" | "toggle" | "getSnapshot" | "subscribe">
}

/** A connector's panel goes to the side panels or the popovers, as its presentation says. */
export function connectorPanelPlaces({
  panels,
  popovers,
}: ConnectorPanelSurfaces): ConnectorPanelPlaces {
  return {
    side: {
      shows: (sessionId, connectorId) =>
        derive([panels], (open) => samePanel(open[sessionId], connectorPanel(connectorId))),
      open: (sessionId, connectorId) => panels.open(sessionId, connectorPanel(connectorId)),
      toggle: (sessionId, connectorId) => panels.toggle(sessionId, connectorPanel(connectorId)),
    },
    popover: {
      shows: (sessionId, connectorId) =>
        derive([popovers], (open) => samePopover(open[sessionId], connectorPopover(connectorId))),
      open: (sessionId, connectorId) => popovers.open(sessionId, connectorPopover(connectorId)),
      toggle: (sessionId, connectorId) => popovers.toggle(sessionId, connectorPopover(connectorId)),
    },
  }
}
