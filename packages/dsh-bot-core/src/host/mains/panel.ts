import {
  type BotMainsView,
  effectiveMainRotation,
  type MainRotationOutcome,
  type MainRotationOverride,
  type MainRotationSettings,
  validateMainRotationOverride,
  validateMainRotationSettings,
} from "../../shared/mains"
import type { MainController } from "./controller"
import type { MainStore } from "./store"

export interface MainPanelDeps {
  store: MainStore
  controller: Pick<MainController, "maintenance" | "startNew" | "pokeAll" | "poke">
  main(botId: string): { readonly sessionId: string; readonly startedAt: number } | undefined
}

export interface MainPanel {
  defaults(): MainRotationSettings
  setDefaults(settings: unknown): Promise<MainRotationSettings>
  view(botId: string): BotMainsView
  configure(botId: string, override: unknown): Promise<BotMainsView>
  startNew(botId: string): Promise<MainRotationOutcome>
}

export function createMainPanel(deps: MainPanelDeps): MainPanel {
  const view = (botId: string): BotMainsView => {
    const main = deps.main(botId)
    if (main === undefined) throw new Error(`bot "${botId}" does not exist`)
    const defaults = deps.store.defaults()
    const override: MainRotationOverride = deps.store.override(botId)
    const activity = deps.store.activity(botId, main.sessionId)
    return {
      botId,
      defaults,
      override,
      effective: effectiveMainRotation(defaults, override),
      status: {
        sessionId: main.sessionId,
        startedAt: main.startedAt,
        ...(activity.lastTurnAt === undefined ? {} : { lastTurnAt: activity.lastTurnAt }),
        compactions: activity.compactions,
        maintenance: deps.controller.maintenance(botId),
      },
    }
  }
  return {
    defaults: () => deps.store.defaults(),
    async setDefaults(settings) {
      const stored = await deps.store.setDefaults(validateMainRotationSettings(settings))
      deps.controller.pokeAll()
      return stored
    },
    view,
    async configure(botId, override) {
      view(botId)
      await deps.store.setOverride(botId, validateMainRotationOverride(override))
      deps.controller.poke(botId)
      return view(botId)
    },
    startNew(botId) {
      view(botId)
      return deps.controller.startNew(botId)
    },
  }
}
