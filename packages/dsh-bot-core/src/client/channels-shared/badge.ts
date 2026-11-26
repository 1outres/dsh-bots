import type { BotChannelSharedView } from "../../shared/channels"
import type { SettingsBadge } from "../settings-frame/sections"

const NEEDS_SETUP: SettingsBadge = {
  tone: "warning",
  label: (t) => t("settings.badge.incomplete"),
}

export function sharedChannelBadge(view: BotChannelSharedView | undefined): SettingsBadge | null {
  if (view === undefined || view.status.state === "ready") return null
  return view.enabledBots > 0 || view.newBots ? NEEDS_SETUP : null
}
