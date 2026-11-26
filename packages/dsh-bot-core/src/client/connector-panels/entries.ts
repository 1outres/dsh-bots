import type { BotConnectorView, ConnectorText } from "../../shared/connectors"
import { constant } from "../observable"
import type { ShellMenuEntry } from "../shell-menu"
import { CONNECTOR_PANEL_GLYPHS } from "./icons"
import type { ConnectorPanelPlaces } from "./places"

/** After the built-in Files (150) and Actions (160) entries. */
const FIRST_ORDER = 200

/** The menu bar button of each connector the bot has on that has a panel, with a dot while it requests. */
export function connectorEntries(
  views: readonly BotConnectorView[],
  places: ConnectorPanelPlaces,
  text: (value: ConnectorText) => string,
): ShellMenuEntry[] {
  return views.flatMap((view, index) => {
    const panel = view.connector.panel
    if (panel === undefined || view.readiness.state === "disabled") return []
    const connectorId = view.connector.id
    const place = places[panel.presentation]
    const waiting = constant(view.status.request !== undefined)
    const entry: ShellMenuEntry = {
      id: `connector:${connectorId}`,
      order: FIRST_ORDER + index,
      label: (t, bot) => t("shell.connector", { title: text(panel.title), name: bot.name }),
      icon: CONNECTOR_PANEL_GLYPHS[panel.icon],
      pressed: ({ sessionId }) => place.shows(sessionId, connectorId),
      attention: () => waiting,
      run: ({ sessionId }) => place.toggle(sessionId, connectorId),
    }
    return [entry]
  })
}
