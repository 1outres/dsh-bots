import type { BotView } from "../../shared/bots"
import {
  createSectionRegistry,
  type FrameSection,
  type FrameSectionProps,
  type SectionRegistry,
} from "../settings-frame/sections"

export type { SettingsBadge, SettingsBadgeTone } from "../settings-frame/sections"

export interface SettingsSectionProps extends FrameSectionProps {
  readonly bot: BotView
}

export type SettingsSection = FrameSection<SettingsSectionProps, string>

export type SettingsSections = SectionRegistry<SettingsSection>

export function createSettingsSections(): SettingsSections {
  return createSectionRegistry<SettingsSection>("settings section")
}
