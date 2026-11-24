import { createElement } from "react"
import { IconSkills } from "../icons"
import type { SkillsClient } from "../skills/client"
import { SkillsSection } from "../skills/SkillsSection"
import type { ClientContext } from "../types"
import type { SettingsScreens } from "./screens"

/** Id of the Skills section of a bot's settings. */
export const SKILLS_SECTION = "bot-core.skills"

/** A bot's Skills section: its skills, their history and restores, and the background review. */
export function wireSkills(
  ctx: ClientContext,
  sources: { readonly skills: SkillsClient; readonly screens: Pick<SettingsScreens, "bot"> },
): void {
  const { skills, screens } = sources
  ctx.effect(
    () =>
      screens.bot.sections.register({
        id: SKILLS_SECTION,
        order: 400,
        label: (t) => t("skills.title"),
        icon: IconSkills,
        component: (props) => createElement(SkillsSection, { ...props, skills }),
      }),
    "bot-core: skills of a bot",
  )
}
