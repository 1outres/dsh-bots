import type { DiscordCommandSpec } from "../discord"

/**
 * `/pending`: the bot's pending connector actions, privately, for one of
 * its approvers. Discord's own command: its answer is the list pinned in
 * the approvers' DMs, linking to their cards.
 */
export const PENDING_COMMAND: DiscordCommandSpec = {
  name: "pending",
  description: "List the connector actions waiting for your decision (the bot's owners only)",
  descriptionJa: "判断を待っているコネクターの操作を一覧します（ボットのオーナーのみ）",
}
