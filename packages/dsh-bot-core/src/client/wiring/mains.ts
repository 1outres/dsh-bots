import { createElement } from "react"
import { IconRefresh } from "../icons"
import type { MainsClient } from "../mains/client"
import { BotMainsSection, GlobalMainsSection } from "../mains/MainsSections"
import type { ClientContext } from "../types"
import type { SettingsScreens } from "./screens"

export const MAINS_SECTION = "bot-core.mains"

export function wireMains(
  ctx: ClientContext,
  sources: {
    readonly mains: MainsClient
    readonly screens: Pick<SettingsScreens, "global" | "bot">
    startNewMain(botId: string): void
  },
): void {
  const { mains, screens } = sources
  ctx.effect(
    () =>
      screens.global.sections.register({
        id: MAINS_SECTION,
        order: 150,
        label: (t) => t("mains.title"),
        icon: IconRefresh,
        component: (props) => createElement(GlobalMainsSection, { ...props, mains }),
      }),
    "bot-core: Main session defaults",
  )
  ctx.effect(
    () =>
      screens.bot.sections.register({
        id: MAINS_SECTION,
        order: 150,
        label: (t) => t("mains.title"),
        icon: IconRefresh,
        component: (props) =>
          createElement(BotMainsSection, { ...props, mains, startNewMain: sources.startNewMain }),
      }),
    "bot-core: Main session of a bot",
  )
}
