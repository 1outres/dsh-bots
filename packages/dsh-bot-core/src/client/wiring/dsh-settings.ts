import { SLOT } from "../dsh/slots"
import { DshSettingsPage, type DshSettingsPageFace } from "../global-settings/DshSettingsPage"
import type { ClientContext } from "../types"
import { NAMESPACE } from "./plugin"

/** The page's place in DSH's settings navigation, after DSH's own pages. */
export const DSH_SETTINGS_PAGE = { id: "dsh-bots", order: 70 } as const

/**
 * bot-core's page in DSH's settings (`settings.section`): the way to the
 * dsh-bots settings. Without DSH's settings shell nothing is registered.
 */
export function wireDshSettings(ctx: ClientContext, face: DshSettingsPageFace): void {
  const t = ctx.locale.bind(NAMESPACE)
  ctx.effect(
    () =>
      ctx.slots.inject(SLOT.settingsSection, () =>
        ctx.slots.register(
          {
            name: SLOT.settingsSection,
            id: DSH_SETTINGS_PAGE.id,
            order: DSH_SETTINGS_PAGE.order,
            label: () => t("dshSettings.nav"),
            locale: NAMESPACE,
            inject: () => face,
          },
          DshSettingsPage,
        ),
      ),
    "bot-core: DSH settings page",
  )
}
