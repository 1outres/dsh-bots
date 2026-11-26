import type { BotSettingsArea } from "../../../settings-contract"
import type { BotChannelText } from "../../../shared/channels"
import { settingValue } from "../../../shared/settings"
import { APPLIED, BOT_SETTINGS_PLACE, placeIn, refused, unknownKey } from "./common"

export interface SkillsAreaDeps {
  view(botId: string): { readonly review: boolean; readonly curator: boolean }
  setReview(botId: string, enabled: boolean): Promise<unknown>
  setCurator(botId: string, enabled: boolean): Promise<unknown>
}

const LABEL: BotChannelText = { en: "Skills", ja: "スキル" }
const TOGGLE = { kind: "toggle" } as const

export function createSkillsArea(deps: SkillsAreaDeps): BotSettingsArea {
  return {
    id: "skills",
    label: LABEL,
    location: placeIn(BOT_SETTINGS_PLACE, LABEL),
    async entries(botId) {
      const view = deps.view(botId)
      return [
        {
          key: "review",
          label: { en: "Background review", ja: "裏での振り返り" },
          agentNote:
            "Whether a background review may save a lesson into your skills after longer conversations with your owner.",
          value: settingValue(TOGGLE, view.review),
          accepts: TOGGLE,
          change: "free",
        },
        {
          key: "curator",
          label: { en: "Skill tidy-up", ja: "スキルの整理" },
          agentNote:
            "Whether a weekly tidy-up may merge your overlapping skills and slim long ones; skills unused for 30 days are archived either way.",
          value: settingValue(TOGGLE, view.curator),
          accepts: TOGGLE,
          change: "free",
        },
      ]
    },
    implied: () => [],
    async apply(botId, changes) {
      const unknown = unknownKey(changes, ["review", "curator"])
      if (unknown !== undefined) return unknown
      try {
        for (const { key, value } of changes) {
          if (typeof value !== "boolean") throw new Error(`${key} must be true or false`)
          if (key === "review") await deps.setReview(botId, value)
          else await deps.setCurator(botId, value)
        }
        return APPLIED
      } catch (error) {
        return refused(error)
      }
    },
  }
}
