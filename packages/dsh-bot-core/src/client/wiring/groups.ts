import { createElement } from "react"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { GroupsSection } from "../groups/GroupsSection"
import type { GroupsFeed } from "../groups/model"
import { GROUPS_SECTION } from "../groups/sections"
import { groupsBadge } from "../groups/view"
import { IconGroups } from "../icons"
import { derive, type Observable } from "../observable"
import type { BotsState } from "../session-classification"
import type { ClientContext } from "../types"
import type { SettingsScreens } from "./screens"

export interface GroupsSources {
  readonly groups: GroupsFeed
  readonly bots: Observable<BotsState>
}

export function wireGroups(
  ctx: ClientContext,
  sources: GroupsSources,
  screens: Pick<SettingsScreens, "global">,
): void {
  const badge = derive([sources.groups], groupsBadge)
  ctx.effect(
    () =>
      screens.global.sections.register({
        id: GROUPS_SECTION,
        order: 260,
        label: (t) => t("global.groups"),
        icon: IconGroups,
        component: (props: GlobalSettingsSectionProps) =>
          createElement(GroupsSection, { ...props, groups: sources.groups, bots: sources.bots }),
        badge: () => badge,
      }),
    "bot-core: bot groups section",
  )
}
