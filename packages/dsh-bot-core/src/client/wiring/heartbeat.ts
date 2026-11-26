import { createElement } from "react"
import type { HeartbeatClient } from "../heartbeat/client"
import { HeartbeatSection } from "../heartbeat/HeartbeatSection"
import { IconHeartbeat } from "../icons"
import type { ClientContext } from "../types"
import type { SettingsScreens } from "./screens"

export const HEARTBEAT_SECTION = "bot-core.heartbeat"

export function wireHeartbeat(
  ctx: ClientContext,
  sources: { readonly heartbeat: HeartbeatClient; readonly screens: Pick<SettingsScreens, "bot"> },
): void {
  const { heartbeat, screens } = sources
  ctx.effect(
    () =>
      screens.bot.sections.register({
        id: HEARTBEAT_SECTION,
        order: 160,
        label: (t) => t("heartbeat.title"),
        icon: IconHeartbeat,
        component: (props) => createElement(HeartbeatSection, { ...props, heartbeat }),
      }),
    "bot-core: heartbeat of a bot",
  )
}
