import { webNeedsAttention } from "../../shared/web"
import type { SettingsBadge } from "../settings-frame/sections"
import type { WebLookupState } from "./feed"

const ATTENTION: SettingsBadge = { tone: "warning", label: (t) => t("web.badge.attention") }

/** Web lookup's nav badge: a warning while a capability that is on cannot be used. */
export function webLookupBadge(state: WebLookupState): SettingsBadge | null {
  return state.status === "ready" && webNeedsAttention(state.view.status) ? ATTENTION : null
}
