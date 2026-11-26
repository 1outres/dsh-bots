import { createElement } from "react"
import type { EnvironmentClient } from "../environment/client"
import { EnvironmentSection } from "../environment/EnvironmentSection"
import { IconServer } from "../icons"
import type { ClientContext } from "../types"
import type { SettingsScreens } from "./screens"

export const ENVIRONMENT_SECTION = "bot-core.environment"

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
