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

export type SettingsScreenId = "bot" | "global"

export interface SettingsScreens {
  readonly bot: { readonly flow: SettingsFlow; readonly sections: SettingsSections }
  readonly global: { readonly flow: GlobalSettingsFlow; readonly sections: GlobalSettingsSections }
  readonly stack: Observable<readonly SettingsScreenId[]>
  openSettings(botId: string, section?: string, detail?: string): void
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
