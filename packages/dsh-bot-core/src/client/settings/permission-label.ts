import type { ConnectorPermission } from "../../shared/connectors"
import type { MessageKey } from "../i18n"

export const PERMISSION_LABEL: Readonly<Record<ConnectorPermission, MessageKey>> = {
  allow: "connectors.permission.allow",
  ask: "connectors.permission.ask",
  disallow: "connectors.permission.disallow",
}
