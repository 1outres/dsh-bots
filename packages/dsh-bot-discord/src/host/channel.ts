import type { BotChannel, BotChannelCapabilities } from "@1outres/dsh-bot-core"
import { type ApprovalTables, openApprovalRecords } from "./actions/records"
import { createDiscordBridge } from "./bridge"
import { createDiscordConnection } from "./connection"
import type { OpenDiscordClient } from "./discord"
import type { FetchUrl } from "./download"
import { DISCORD_FIELDS } from "./fields"
import type { Scheduler } from "./ports"

export interface DiscordChannelDeps {
  open: OpenDiscordClient
  scheduler: Scheduler
  fetch: FetchUrl
  /** The tables of DISCORD_DOMAIN: where every bot's approval messages sit. */
  approvals: ApprovalTables
  warn(message: string): void
}

/** Discord's limits: 10 attachments per message; uploads of a bot without a boosted server, 10 MiB. */
export const DISCORD_CAPABILITIES = {
  attachments: { maxCount: 10, maxBytes: 500 * 1024 * 1024 },
  files: { maxBytes: 10 * 1024 * 1024 },
  turns: true,
  interactions: ["question", "approval", "plan-review"],
  commands: ["stop", "status", "new"],
  connectorActions: true,
} as const satisfies BotChannelCapabilities

/** The `discord` channel: one Discord bot (its own token) per DSH bot, in direct messages. */
export function createDiscordChannel(deps: DiscordChannelDeps): BotChannel<typeof DISCORD_FIELDS> {
  return {
    id: "discord",
    name: "Discord",
    description: {
      en: "Direct messages with a Discord bot of this bot's own. Create one in the Discord Developer Portal and share a server with each allowed user.",
      ja: "このボット専用の Discord ボットとのダイレクトメッセージ。Discord Developer Portal で作成し、会話するユーザーとサーバーを共有してください。",
    },
    guide: "https://github.com/1outres/dsh-bots/tree/main/packages/dsh-bot-discord#discord-setup",
    fields: DISCORD_FIELDS,
    owners: "approvers",
    capabilities: DISCORD_CAPABILITIES,
    formatHint:
      "Markdown renders, tables do not; wrap a link in <> to keep it from expanding into a preview.",
    connect(link) {
      return createDiscordBridge({
        link,
        channelId: "discord",
        connect: (events) =>
          createDiscordConnection({
            token: link.settings.token,
            open: deps.open,
            scheduler: deps.scheduler,
            events,
            report: (state) => link.report(state),
          }),
        scheduler: deps.scheduler,
        fetch: deps.fetch,
        records: openApprovalRecords(deps.approvals, link.bot.id),
        warn: deps.warn,
      })
    },
  }
}
