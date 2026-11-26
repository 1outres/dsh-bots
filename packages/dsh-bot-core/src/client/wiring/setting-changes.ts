import { createElement } from "react"
import type { BotChannelText } from "../../shared/channels"
import { IconRefresh } from "../icons"
import type { SettingChangesClient } from "../setting-changes/client"
import { SettingChangesSection } from "../setting-changes/SettingChangesSection"
import type { ClientContext } from "../types"
import type { SettingsScreens } from "./screens"

export const SETTING_CHANGES_SECTION = "bot-core.setting-changes"

export function wireSettingChanges(
  ctx: ClientContext,
  sources: {
    readonly changes: SettingChangesClient
    readonly screens: Pick<SettingsScreens, "bot">
  },
): void {
  const { changes, screens } = sources
  const text = (value: BotChannelText) => ctx.locale.resolveText({ ...value })
  ctx.effect(
    () =>
      screens.bot.sections.register({
        id: SETTING_CHANGES_SECTION,
        order: 450,
        label: (t) => t("settingChanges.title"),
        icon: IconRefresh,
        component: (props) => createElement(SettingChangesSection, { ...props, changes, text }),
      }),
    "bot-core: setting changes of a bot",
  )
}
