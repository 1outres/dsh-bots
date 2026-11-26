import {
  createSectionRegistry,
  type FrameSection,
  type FrameSectionProps,
  type SectionRegistry,
} from "../settings-frame/sections"

export type GlobalSettingsSectionProps = FrameSectionProps

export type GlobalSettingsSection = FrameSection<GlobalSettingsSectionProps, void>

export type GlobalSettingsSections = SectionRegistry<GlobalSettingsSection>

export function createGlobalSettingsSections(): GlobalSettingsSections {
  return createSectionRegistry<GlobalSettingsSection>("global settings section")
}
