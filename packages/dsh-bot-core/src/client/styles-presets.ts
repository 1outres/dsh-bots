import type { BotView } from "../shared/bots"
import { botPresetId } from "../shared/preset"

/**
 * CSS that hides the bots' presets from Settings > Agent presets, where every
 * preset of the registry is listed (and could be made the new-task default).
 * A bot's preset belongs to that bot: sessions get it through the bot, never
 * by choice. Only the presets of this bot-core's bots are hidden, by exact
 * id, so a user's own preset that merely starts with "bot-" stays listed.
 */
export function hiddenPresetsCss(bots: readonly BotView[]): string {
  return [...new Set(bots.map((bot) => botPresetId(bot.id)))]
    .sort()
    .map((id) => `[data-agent-preset-id=${JSON.stringify(id)}] { display: none !important; }`)
    .join("\n")
}
