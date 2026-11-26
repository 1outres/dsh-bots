import type { BotChannelStatus } from "../../shared/channels"
import type { ChannelsState } from "../channels-model"
import type { MessageKey } from "../i18n"
import type { SettingsBadge, SettingsBadgeTone } from "./sections"

type BadgeKind = "failed" | "incomplete" | "connecting" | "connected"

const RANK: readonly BadgeKind[] = ["failed", "incomplete", "connecting", "connected"]

const TONE: Readonly<Record<BadgeKind, SettingsBadgeTone>> = {
  failed: "danger",
  incomplete: "warning",
  connecting: "pending",
  connected: "success",
}

const LABEL: Readonly<Record<BadgeKind, MessageKey>> = {
  failed: "settings.badge.failed",
  incomplete: "settings.badge.incomplete",
  connecting: "settings.badge.connecting",
  connected: "settings.badge.connected",
}

function kindOf(status: BotChannelStatus): BadgeKind | undefined {
  switch (status.state) {
    case "off":
      return undefined
    case "unconfigured":
      return "incomplete"
    case "failed":
    case "incomplete":
    case "connecting":
    case "connected":
      return status.state
    case "waiting":
      return "connecting"
  }
}

const badge = (kind: BadgeKind): SettingsBadge => ({
  tone: TONE[kind],
  label: (t) => t(LABEL[kind]),
})

const BADGES: Readonly<Record<BadgeKind, SettingsBadge>> = {
  failed: badge("failed"),
  incomplete: badge("incomplete"),
  connecting: badge("connecting"),
  connected: badge("connected"),
}

export function channelsBadge(state: ChannelsState): SettingsBadge | null {
  if (state.status !== "ready") return null
  const kinds = new Set(state.snapshot.channels.map((view) => kindOf(view.status)))
  const worst = RANK.find((kind) => kinds.has(kind))
  return worst === undefined ? null : BADGES[worst]
}
