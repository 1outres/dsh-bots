import type { ComponentType } from "react"
import type { ConnectorPanelIcon } from "../../shared/connectors"
import { IconCalendar, IconFolder, IconGlobe, IconMail, IconScreen } from "../icons"

export const CONNECTOR_PANEL_GLYPHS: {
  readonly [Icon in ConnectorPanelIcon]: ComponentType<{ size?: number }>
} = {
  desktop: IconScreen,
  browser: IconGlobe,
  mail: IconMail,
  calendar: IconCalendar,
  files: IconFolder,
}
