import {
  createSectionRegistry,
  type FrameSection,
  type FrameSectionProps,
  type SectionRegistry,
} from "../settings-frame/sections"

/** What the dsh-bots settings screen hands the section it shows: nothing of any bot. */
export type GlobalSettingsSectionProps = FrameSectionProps

/** One section of the dsh-bots settings screen, shared by every bot. */
export type GlobalSettingsSection = FrameSection<GlobalSettingsSectionProps, void>

export type GlobalSettingsSections = SectionRegistry<GlobalSettingsSection>

export function createGlobalSettingsSections(): GlobalSettingsSections {
  return createSectionRegistry<GlobalSettingsSection>("global settings section")
}
