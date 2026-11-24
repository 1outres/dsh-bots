import { createElement } from "react"
import type { EnvironmentClient } from "../environment/client"
import { EnvironmentSection } from "../environment/EnvironmentSection"
import { IconServer } from "../icons"
import type { ClientContext } from "../types"
import type { SettingsScreens } from "./screens"

/** Id of the VM section of a bot's settings. */
export const ENVIRONMENT_SECTION = "bot-core.environment"

/** A bot's VM section: the CPUs, memory and disk of its VM. */
export function wireEnvironment(
  ctx: ClientContext,
  sources: {
    readonly environment: EnvironmentClient
    readonly screens: Pick<SettingsScreens, "bot">
  },
): void {
  const { environment, screens } = sources
  ctx.effect(
    () =>
      screens.bot.sections.register({
        id: ENVIRONMENT_SECTION,
        order: 250,
        label: (t) => t("settings.environment"),
        icon: IconServer,
        component: (props) => createElement(EnvironmentSection, { ...props, environment }),
      }),
    "bot-core: VM of a bot",
  )
}
