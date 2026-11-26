import { createElement } from "react"
import type { GlobalSettingsSection, GlobalSettingsSectionProps } from "../global-settings/sections"
import { IconGlobe } from "../icons"
import { derive } from "../observable"
import type { ClientContext } from "../types"
import { webLookupBadge } from "../web/badge"
import type { WebLookupFeed } from "../web/feed"
import { WebLookupSection } from "../web/WebLookupSection"
import type { SettingsScreens } from "./screens"

export const WEB_LOOKUP_SECTION = "bot-core.web"

export function wireWebLookup(
  ctx: ClientContext,
  feed: WebLookupFeed,
  screens: Pick<SettingsScreens, "global">,
): void {
  const badge = derive([feed], webLookupBadge)
  const text = (value: { readonly en: string; readonly ja?: string }) =>
    ctx.locale.resolveText({ ...value })
  const section: GlobalSettingsSection = {
    id: WEB_LOOKUP_SECTION,
    order: 100,
    label: (t) => t("web.title"),
    icon: IconGlobe,
    component: (props: GlobalSettingsSectionProps) =>
      createElement(WebLookupSection, { ...props, feed, text }),
    badge: () => badge,
  }
  ctx.effect(() => screens.global.sections.register(section), "bot-core: Web lookup section")
}
