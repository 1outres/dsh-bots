import type { BotView } from "../../shared/bots"
import {
  createSectionRegistry,
  type FrameSection,
  type FrameSectionProps,
  type SectionRegistry,
} from "../settings-frame/sections"

export type { SettingsBadge, SettingsBadgeTone } from "../settings-frame/sections"

/** What a bot's settings screen hands the section it shows. */
export interface SettingsSectionProps extends FrameSectionProps {
  readonly bot: BotView
}

/** One section of a bot's settings screen; its badge is computed per bot id. */
export type SettingsSection = FrameSection<SettingsSectionProps, string>

export type SettingsSections = SectionRegistry<SettingsSection>

export function createSettingsSections(): SettingsSections {
  return createSectionRegistry<SettingsSection>("settings section")
}
