import {
  GlobalSettingsScreen,
  type GlobalSettingsScreenFace,
} from "../global-settings/GlobalSettingsScreen"
import type { ClientContext } from "../types"
import { overlay } from "./dialogs"
import type { SettingsScreens } from "./screens"

export function wireGlobalSettings(ctx: ClientContext, screens: SettingsScreens): void {
  const { flow, sections } = screens.global
  overlay(
    ctx,
    "bot-core.global-settings",
    () => ({ flow, sections, stack: screens.stack }) satisfies GlobalSettingsScreenFace,
    GlobalSettingsScreen,
  )
}
