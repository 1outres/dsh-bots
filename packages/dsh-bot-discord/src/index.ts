/**
 * `@1outres/dsh-bot-discord` (row `bot-discord`): registers the `discord`
 * channel with bot-core. This file is the composition root: it wires the
 * Host modules to timers, to discord.js and to DSH's storage domains.
 */
import type { Bot } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import type { CardRecord, DigestRecord } from "./host/actions/domain"
import { purgeApprovalRecords, type RecordTable } from "./host/actions/records"
import { createDiscordChannel } from "./host/channel"
import { discordJsClients } from "./host/discordjs/client"
import { discordJsLookups } from "./host/discordjs/lookup"
import { DISCORD_DOMAIN } from "./host/domain"
import type { IncidentNoticeRecord } from "./host/incidents/domain"
import { purgeIncidentNotices } from "./host/incidents/records"
import type { Scheduler } from "./host/ports"

export const name = "bot-discord"
/**
 * The `bot` service of @1outres/dsh-bot-core. Only types come from that
 * package: a value import would bundle bot-core's runtime into this one.
 */
const BOT = "bot"
const STORAGE = "storageDomain"
export const inject = ["bot", "storageDomain"]

interface DiscordDomain {
  table(name: "cards"): RecordTable<CardRecord>
  table(name: "digests"): RecordTable<DigestRecord>
  table(name: "incidents"): RecordTable<IncidentNoticeRecord>
  close(): Promise<void>
}

interface StorageDomains {
  open(spec: typeof DISCORD_DOMAIN): Promise<DiscordDomain>
}

function serviceOf<T>(ctx: Context, name: string): T {
  const service = ctx.get(name) as T | undefined
  if (service === undefined) throw new Error(`the "${name}" service is not available; inject it`)
  return service
}

const botOf = (ctx: Context) => serviceOf<Bot>(ctx, BOT)

export async function apply(ctx: Context): Promise<void> {
  const domain = await serviceOf<StorageDomains>(ctx, STORAGE).open(DISCORD_DOMAIN)
  ctx.effect(() => () => void domain.close(), "bot-discord: storage domain")
  const approvals = { cards: domain.table("cards"), digests: domain.table("digests") }
  const incidents = domain.table("incidents")
  const bots = botOf(ctx)
  const listed = (botId: string) => bots.botIds().includes(botId)
  await purgeApprovalRecords(approvals, listed)
  await purgeIncidentNotices(incidents, listed)

  const timers = new Set<ReturnType<typeof setTimeout>>()
  ctx.effect(
    () => () => {
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    },
    "bot-discord: timers",
  )
  const scheduler: Scheduler = {
    later(ms, work) {
      const timer = setTimeout(() => {
        timers.delete(timer)
        work()
      }, ms)
      timers.add(timer)
      return () => {
        clearTimeout(timer)
        timers.delete(timer)
      }
    },
  }
  const warn = (message: string) => ctx.logger.warn(message)
  const channel = createDiscordChannel({
    open: discordJsClients({ warn }),
    lookup: discordJsLookups,
    scheduler,
    fetch: (url, init) => fetch(url, init),
    approvals,
    incidents,
    warn,
  })
  ctx.effect(() => botOf(ctx).registerChannel(channel), "bot-discord: channel")
}
