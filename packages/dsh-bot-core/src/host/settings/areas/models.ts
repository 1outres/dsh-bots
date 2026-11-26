import type { BotSettingsArea } from "../../../settings-contract"
import type { BotChannelText } from "../../../shared/channels"
import {
  type BotModelCatalog,
  type BotModelChoice,
  type BotModelsChange,
  type BotModelsView,
  MAX_DELEGATE_MODELS,
  PROFILE_DEFAULT_MODEL,
} from "../../../shared/models"
import {
  type BotSettingChoice,
  type BotSettingEntry,
  type BotSettingItemShape,
  settingValue,
} from "../../../shared/settings"
import { APPLIED, BOT_SETTINGS_PLACE, placeIn, refused, unknownKey } from "./common"

export interface ModelsAreaDeps {
  view(botId: string): BotModelsView
  configure(botId: string, change: BotModelsChange): Promise<BotModelsView>
  catalog(): Promise<BotModelCatalog>
}

const LABEL: BotChannelText = { en: "Models", ja: "モデル" }

export const PROFILE_DEFAULT_TOKEN = "profile-default"

interface ModelOffer extends BotSettingChoice {
  readonly choice: BotModelChoice
}

export function modelToken(choice: BotModelChoice): string {
  if (choice.kind === "profile-default") return PROFILE_DEFAULT_TOKEN
  const base = `${choice.provider}/${choice.model}`
  return choice.reasoningEffort === undefined ? base : `${base}@${choice.reasoningEffort}`
}

function offersOf(catalog: BotModelCatalog): readonly ModelOffer[] {
  const named = `${catalog.profileDefault.provider}/${catalog.profileDefault.model}`
  return [
    {
      value: PROFILE_DEFAULT_TOKEN,
      label: { en: `DSH default (${named})`, ja: `DSH の既定（${named}）` },
      choice: PROFILE_DEFAULT_MODEL,
    },
    ...catalog.providers.flatMap((provider) =>
      provider.models.flatMap((model): ModelOffer[] => {
        const name = `${provider.name} · ${model.name}`
        const fixed = { kind: "fixed" as const, provider: provider.id, model: model.id }
        return [
          { value: modelToken(fixed), label: { en: name }, choice: fixed },
          ...(model.reasoning?.efforts ?? []).map((effort) => {
            const choice = { ...fixed, reasoningEffort: effort.id }
            return {
              value: modelToken(choice),
              label: {
                en: `${name}, reasoning effort ${effort.name}`,
                ja: `${name}、推論の強さ ${effort.name}`,
              },
              choice,
            }
          }),
        ]
      }),
    ),
  ]
}

const ROLE_NOTES = {
  main: "The model of your Main session and of every session started for you; the Main session switches at its next step.",
  utility: "A light model for formatting work; stored for later use, nothing uses it yet.",
  delegates: "The models a session you start may run, in order; stored for later use.",
} as const

export function createModelsArea(deps: ModelsAreaDeps): BotSettingsArea {
  const read = async (botId: string) => {
    const [view, catalog] = [deps.view(botId), await deps.catalog()]
    return { view, offers: offersOf(catalog) }
  }
  const shapeOf = (offers: readonly ModelOffer[]): BotSettingItemShape => ({
    kind: "choice",
    choices: offers.map(({ value, label }) => ({ value, label })),
  })
  return {
    id: "models",
    label: LABEL,
    location: placeIn(BOT_SETTINGS_PLACE, LABEL),
    async entries(botId): Promise<readonly BotSettingEntry[]> {
      const { view, offers } = await read(botId)
      const one = shapeOf(offers)
      return [
        {
          key: "main",
          label: { en: "Main", ja: "メイン" },
          agentNote: ROLE_NOTES.main,
          value: settingValue(one, modelToken(view.models.main)),
          accepts: one,
          change: "approve",
        },
        {
          key: "utility",
          label: { en: "Utility", ja: "補助" },
          agentNote: ROLE_NOTES.utility,
          value: settingValue(one, modelToken(view.models.utility)),
          accepts: one,
          change: "approve",
        },
        {
          key: "delegates",
          label: { en: "Delegates", ja: "委任先" },
          agentNote: ROLE_NOTES.delegates,
          value: {
            raw: view.models.delegates.map(modelToken),
            shown: settingValue(
              { kind: "list", minItems: 0, maxItems: MAX_DELEGATE_MODELS, item: one },
              view.models.delegates.map(modelToken),
            ).shown,
          },
          accepts: { kind: "list", minItems: 0, maxItems: MAX_DELEGATE_MODELS, item: one },
          change: "approve",
        },
      ]
    },
    implied: () => [],
    async apply(botId, changes) {
      const unknown = unknownKey(changes, ["main", "utility", "delegates"])
      if (unknown !== undefined) return unknown
      try {
        const offers = offersOf(await deps.catalog())
        const choiceOf = (token: unknown): BotModelChoice => {
          const offer = offers.find((known) => known.value === token)
          if (offer === undefined)
            throw new Error(`${JSON.stringify(token)} is not a model DSH offers`)
          return offer.choice
        }
        const change: { -readonly [Role in keyof BotModelsChange]: BotModelsChange[Role] } = {}
        for (const { key, value } of changes) {
          if (key === "delegates") {
            if (!Array.isArray(value)) throw new Error("delegates must be a list")
            change.delegates = value.map(choiceOf)
          } else if (key === "main" || key === "utility") {
            change[key] = choiceOf(value)
          }
        }
        await deps.configure(botId, change)
        return APPLIED
      } catch (error) {
        return refused(error)
      }
    },
  }
}
