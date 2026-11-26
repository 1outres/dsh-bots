import type { BotSettingsArea } from "../../../settings-contract"
import type { BotAvatar, BotUpdateInput, BotView } from "../../../shared/bots"
import { MAX_NAME_LENGTH } from "../../../shared/bots"
import type { BotChannelText } from "../../../shared/channels"
import { type BotSettingEntry, settingValue } from "../../../shared/settings"
import { languageName } from "../../main"
import { APPLIED, BOT_SETTINGS_PLACE, changesByKey, placeIn, refused, unknownKey } from "./common"

export interface GeneralAreaDeps {
  bot(botId: string): BotView | undefined
  update(botId: string, input: BotUpdateInput): Promise<BotView>
}

const LABEL: BotChannelText = { en: "General", ja: "一般" }

const LANGUAGE_TAG = "[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*"

const NOT_SET: BotChannelText = { en: "Not set", ja: "未設定" }

function avatarShown(avatar: BotAvatar): BotChannelText {
  switch (avatar.kind) {
    case "emoji":
      return { en: `${avatar.emoji} (emoji)`, ja: `${avatar.emoji}（絵文字）` }
    case "initial":
      return { en: `${avatar.text} (initials)`, ja: `${avatar.text}（文字）` }
    case "image":
      return { en: "An image", ja: "画像" }
  }
}

function entriesOf(bot: BotView): readonly BotSettingEntry[] {
  return [
    {
      key: "name",
      label: { en: "Name", ja: "名前" },
      agentNote:
        "Your name: what people and the Web UI call you; your Main session's title follows it.",
      value: settingValue(undefined, bot.name),
      accepts: { kind: "text", maxLength: MAX_NAME_LENGTH },
      change: "approve",
    },
    {
      key: "avatar",
      label: { en: "Avatar", ja: "アバター" },
      agentNote: "The picture beside your name in the Web UI.",
      value: { raw: bot.avatar.kind, shown: avatarShown(bot.avatar) },
      change: "never",
    },
    {
      key: "language",
      label: { en: "Language", ja: "言語" },
      agentNote:
        "Your owner's language: the Web UI names and places in bot_settings follow it, and so do your greetings; you still reply in the language each person writes in.",
      value:
        bot.language === undefined
          ? { raw: "", shown: NOT_SET }
          : { raw: bot.language, shown: { en: `${languageName(bot.language)} (${bot.language})` } },
      accepts: { kind: "text", maxLength: 35, pattern: LANGUAGE_TAG },
      change: "free",
    },
    {
      key: "timezone",
      label: { en: "Time zone", ja: "タイムゾーン" },
      agentNote:
        "Your time zone (IANA, such as Asia/Tokyo): the times of your schedule jobs, daily notes and the daily new Main session follow it.",
      value: settingValue(undefined, bot.timezone),
      accepts: { kind: "text", maxLength: 64 },
      change: "free",
    },
  ]
}

export function createGeneralArea(deps: GeneralAreaDeps): BotSettingsArea {
  const requireBot = (botId: string) => {
    const bot = deps.bot(botId)
    if (bot === undefined) throw new Error(`bot "${botId}" does not exist`)
    return bot
  }
  return {
    id: "general",
    label: LABEL,
    location: placeIn(BOT_SETTINGS_PLACE, LABEL),
    entries: async (botId) => entriesOf(requireBot(botId)),
    implied: () => [],
    async apply(botId, changes) {
      const unknown = unknownKey(changes, ["name", "language", "timezone"])
      if (unknown !== undefined) return unknown
      const edits = changesByKey(changes)
      const text = (key: string) => {
        const value = edits.get(key)
        return typeof value === "string" ? value : undefined
      }
      const name = text("name")
      const language = text("language")
      const timezone = text("timezone")
      try {
        await deps.update(botId, {
          ...(name === undefined ? {} : { name }),
          ...(language === undefined ? {} : { language }),
          ...(timezone === undefined ? {} : { timezone }),
        })
        return APPLIED
      } catch (error) {
        return refused(error)
      }
    },
  }
}
