import type { DiscordCommandSpec } from "../discord"

export const PENDING_COMMAND: DiscordCommandSpec = {
  name: "pending",
  description: "List the connector actions waiting for your decision (the bot's owners only)",
  descriptionJa: "判断を待っているコネクターの操作を一覧します（ボットのオーナーのみ）",
}
