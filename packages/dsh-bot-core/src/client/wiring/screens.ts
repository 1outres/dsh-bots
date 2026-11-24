import { createGlobalSettingsFlow, type GlobalSettingsFlow } from "../global-settings/flow"
import {
  createGlobalSettingsSections,
  type GlobalSettingsSections,
} from "../global-settings/sections"
import type { Observable } from "../observable"
import { createSettingsFlow, type SettingsFlow } from "../settings/flow"
import { createSettingsSections, type SettingsSections } from "../settings/sections"
import { openAlone } from "../settings-frame/exclusive"
import { createScreenStack } from "../settings-frame/stack"
import type { DialogStores } from "./dialogs"

/** bot-core's settings screens, as the modal stack names them. */
export type SettingsScreenId = "bot" | "global"

/**
 * bot-core's two settings screens, a bot's and the dsh-bots one. The dsh-bots
 * screen opens over a bot's (a modal stack: closing it returns to the bot's
 * screen as it was); a bot's screen opens alone.
 */
export interface SettingsScreens {
  readonly bot: { readonly flow: SettingsFlow; readonly sections: SettingsSections }
  readonly global: { readonly flow: GlobalSettingsFlow; readonly sections: GlobalSettingsSections }
  /** The open screens, bottom first; only the last takes input. */
  readonly stack: Observable<readonly SettingsScreenId[]>
  /**
   * Open the bot's settings at `section` and `detail` once the dsh-bots settings are closed.
   * @throws when `section` is not a registered settings section.
   */
  openSettings(botId: string, section?: string, detail?: string): void
  /**
   * Open the dsh-bots settings at `section` and `detail`, over a bot's settings when they are open.
   * @throws when `section` is not a registered global settings section.
   */
  openGlobalSettings(section?: string, detail?: string): void
  dispose(): void
}

export function createSettingsScreens(
  dialogs: Pick<DialogStores, "settings" | "globalSettings">,
): SettingsScreens {
  const botSections = createSettingsSections()
  const globalSections = createGlobalSettingsSections()
  const bot = createSettingsFlow(dialogs.settings, botSections)
  const global = createGlobalSettingsFlow(dialogs.globalSettings, globalSections)
  const stack = createScreenStack<SettingsScreenId>([
    { id: "bot", target: bot.target },
    { id: "global", target: global.target },
  ])
  return {
    bot: { flow: bot, sections: botSections },
    global: { flow: global, sections: globalSections },
    stack,
    openSettings: (botId, section, detail) =>
      openAlone([global], () => bot.open(botId, section, detail)),
    openGlobalSettings: (section, detail) => global.open(section, detail),
    dispose() {
      stack.dispose()
      bot.dispose()
      global.dispose()
    },
  }
}
