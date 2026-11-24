import type { BotConnectorView, ConnectorText } from "../../shared/connectors"
import { constant, derive } from "../observable"
import { connectorPanel, type SidePanels, samePanel } from "../shell/side-panels"
import type { ShellMenuEntry } from "../shell-menu"
import { CONNECTOR_PANEL_GLYPHS } from "./icons"

/** After the built-in Files (150) and Actions (160) entries. */
const FIRST_ORDER = 200

/** The menu bar button of each connector the bot has on that has a panel, with a dot while it requests. */
export function connectorEntries(
  views: readonly BotConnectorView[],
  panels: Pick<SidePanels, "toggle" | "getSnapshot" | "subscribe">,
  text: (value: ConnectorText) => string,
): ShellMenuEntry[] {
  return views.flatMap((view, index) => {
    const panel = view.connector.panel
    if (panel === undefined || view.readiness.state === "disabled") return []
    const own = connectorPanel(view.connector.id)
    const waiting = constant(view.status.request !== undefined)
    const entry: ShellMenuEntry = {
      id: `connector:${view.connector.id}`,
      order: FIRST_ORDER + index,
      label: (t, bot) => t("shell.connector", { title: text(panel.title), name: bot.name }),
      icon: CONNECTOR_PANEL_GLYPHS[panel.icon],
      pressed: ({ sessionId }) => derive([panels], (open) => samePanel(open[sessionId], own)),
      attention: () => waiting,
      run: ({ sessionId }) => panels.toggle(sessionId, own),
    }
    return [entry]
  })
}
