import type { BotChannel, BotChannelCapabilities } from "@1outres/dsh-bot-core"
import {
  type ApprovalTables,
  adoptApprovalRecords,
  openApprovalRecords,
  type RecordTable,
} from "./actions/records"
import { createDiscordBridge } from "./bridge"
import { createDiscordConnection } from "./connection"
import type { OpenDiscordClient, OpenDiscordLookup } from "./discord"
import type { FetchUrl } from "./download"
import { DISCORD_FIELDS, DISCORD_SETTINGS_VERSION } from "./fields"
import { audienceOf, gatewayModeOf, homeOf } from "./home"
import type { IncidentNoticeRecord } from "./incidents/domain"
import { adoptIncidentNotices, openIncidentNotices } from "./incidents/records"
import { createPresence, ownerNames } from "./people"
import type { Scheduler } from "./ports"
import type { ProfileRecord } from "./profile/domain"
import { openProfileRecords } from "./profile/records"
import type { InquiryCardRecord } from "./senders/domain"
import { adoptInquiryCards, openInquiryCards } from "./senders/records"
import { createDiscordSettingsQueries } from "./settings/queries"
import { upgradeDiscordSettings } from "./upgrade"

export interface DiscordChannelDeps {
  open: OpenDiscordClient
  lookup: OpenDiscordLookup
  scheduler: Scheduler
  fetch: FetchUrl
  approvals: ApprovalTables
  incidents: RecordTable<IncidentNoticeRecord>
  profiles: RecordTable<ProfileRecord>
  inquiryCards: RecordTable<InquiryCardRecord>
  warn(message: string): void
}

export const DISCORD_CAPABILITIES = {
  attachments: { maxCount: 10, maxBytes: 500 * 1024 * 1024 },
  files: { maxBytes: 10 * 1024 * 1024 },
  turns: true,
  interactions: ["question", "approval", "plan-review"],
  commands: ["stop", "status", "new"],
  connectorActions: true,
  credentialIncidents: true,
  profile: { name: true, avatar: true },
  senderInquiries: true,
} as const satisfies BotChannelCapabilities

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createDiscordChannel(deps: DiscordChannelDeps): BotChannel<typeof DISCORD_FIELDS> {
  const queries = createDiscordSettingsQueries(deps.lookup)
  return {
    id: "discord",
    name: "Discord",
    description: {
      en: "A Discord bot of this bot's own, at one home: direct messages with you, or a server text channel everyone there can talk in. Create it in the Discord Developer Portal.",
      ja: "このボット専用の Discord ボット。ホームは 1 つ: あなたとのダイレクトメッセージか、そこにいる全員が話せるサーバーのテキストチャンネル。Discord Developer Portal で作成します。",
    },
    guide: "https://github.com/1outres/dsh-bots/tree/main/packages/dsh-bot-discord#discord-setup",
    setup: [
      {
        en: "In the Discord Developer Portal, create a New Application for this bot.",
        ja: "Discord Developer Portal で、このボット用に New Application を作成します。",
      },
      {
        en: "Under Bot, Reset Token and paste it below.",
        ja: "Bot で Reset Token を押し、トークンを下に貼り付けます。",
      },
      {
        en: "Invite the bot to a server with the invite link below (a DM needs a server you share with it).",
        ja: "下の招待リンクでボットをサーバーに招待します（DM でもボットと共通のサーバーが必要です）。",
      },
      {
        en: "For a server channel, turn on Message Content and Server Members under Bot > Privileged Gateway Intents.",
        ja: "サーバーのチャンネルで使うなら、Bot > Privileged Gateway Intents で Message Content と Server Members をオンにします。",
      },
      {
        en: "Pick the home and its owners below.",
        ja: "下でホームとオーナーを選びます。",
      },
    ],
    fields: DISCORD_FIELDS,
    owners: "approvers",
    capabilities: DISCORD_CAPABILITIES,
    settingsVersion: DISCORD_SETTINGS_VERSION,
    upgradeSettings: upgradeDiscordSettings,
    options: (request) => queries.options(request),
    check: (request) => queries.check(request),
    inspect: (request) => queries.inspect(request),
    formatHint:
      "Markdown renders, tables do not; wrap a link in <> to keep it from expanding into a preview.",
    audience: audienceOf,
    connect(link) {
      const home = homeOf(link.settings)
      const presence = createPresence((state) => link.report(state))
      ownerNames(deps.lookup(link.settings.token), home, link.settings.approvers, link.signal).then(
        (people) => {
          if (!link.signal.aborted) presence.named(people)
        },
        (error: unknown) => {
          if (!link.signal.aborted)
            deps.warn(`bot-discord: could not read the names of the owners: ${messageOf(error)}`)
        },
      )
      return createDiscordBridge({
        link,
        home,
        adopt: async (homeChannelId) => {
          await adoptApprovalRecords(deps.approvals, link.bot.id, homeChannelId)
          await adoptIncidentNotices(deps.incidents, link.bot.id, homeChannelId)
          await adoptInquiryCards(deps.inquiryCards, link.bot.id, homeChannelId)
        },
        channelId: "discord",
        connect: (events) =>
          createDiscordConnection({
            token: link.settings.token,
            mode: gatewayModeOf(home),
            open: deps.open,
            scheduler: deps.scheduler,
            events,
            report: (state) => presence.report(state),
          }),
        scheduler: deps.scheduler,
        fetch: deps.fetch,
        records: openApprovalRecords(deps.approvals, link.bot.id),
        incidents: openIncidentNotices(deps.incidents, link.bot.id),
        profiles: openProfileRecords(deps.profiles, link.bot.id),
        inquiries: openInquiryCards(deps.inquiryCards, link.bot.id),
        warn: deps.warn,
      })
    },
  }
}
