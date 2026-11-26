import type { BotView } from "../shared/bots"
import { botPresetId } from "../shared/preset"

export function hiddenPresetsCss(bots: readonly BotView[]): string {
  return [...new Set(bots.map((bot) => botPresetId(bot.id)))]
    .sort()
    .map((id) => `[data-agent-preset-id=${JSON.stringify(id)}] { display: none !important; }`)
    .join("\n")
}
