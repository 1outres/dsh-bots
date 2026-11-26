import type { ConnectorReadiness } from "../../shared/connectors"
import type { ConnectorsState } from "../connectors-model"
import type { MessageKey } from "../i18n"
import type { SettingsBadge, SettingsBadgeTone } from "./sections"

type BadgeKind = Exclude<ConnectorReadiness["state"], "disabled">

const RANK: readonly BadgeKind[] = ["failed", "unavailable", "preparing", "ready"]

const TONE: Readonly<Record<BadgeKind, SettingsBadgeTone>> = {
  failed: "danger",
  unavailable: "warning",
  preparing: "pending",
  ready: "success",
}

const LABEL: Readonly<Record<BadgeKind, MessageKey>> = {
  failed: "settings.badge.preparationFailed",
  unavailable: "settings.badge.unavailable",
  preparing: "settings.badge.preparing",
  ready: "settings.badge.ready",
}

const BADGES = Object.fromEntries(
  RANK.map((kind) => [kind, { tone: TONE[kind], label: (t) => t(LABEL[kind]) }]),
) as Readonly<Record<BadgeKind, SettingsBadge>>

export function connectorsBadge(state: ConnectorsState): SettingsBadge | null {
  if (state.status !== "ready") return null
  const states = new Set(state.snapshot.connectors.map((view) => view.readiness.state))
  const worst = RANK.find((kind) => states.has(kind))
  return worst === undefined ? null : BADGES[worst]
}
