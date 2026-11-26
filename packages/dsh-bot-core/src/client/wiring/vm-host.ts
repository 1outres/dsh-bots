import { createElement } from "react"
import type { GlobalSettingsSectionProps } from "../global-settings/sections"
import { IconServer } from "../icons"
import { derive } from "../observable"
import type { ClientContext } from "../types"
import type { VmHostClient } from "../vm-host/client"
import { vmHostBadge } from "../vm-host/model"
import { VmHostSection } from "../vm-host/VmHostSection"
import type { SettingsScreens } from "./screens"

/** Id of the VM host section of the dsh-bots settings. */
export const VM_HOST_SECTION = "bot-core.vm-host"

/** Where the bots' VMs run, in the dsh-bots settings. */
export function wireVmHost(
  ctx: ClientContext,
  host: VmHostClient,
  screens: Pick<SettingsScreens, "global">,
): void {
  const badge = derive([host], vmHostBadge)
  ctx.effect(
    () =>
      screens.global.sections.register({
        id: VM_HOST_SECTION,
        order: 120,
        label: (t) => t("vmHost.title"),
        icon: IconServer,
        component: (props: GlobalSettingsSectionProps) =>
          createElement(VmHostSection, { ...props, host }),
        badge: () => badge,
      }),
    "bot-core: VM host section",
  )
}
