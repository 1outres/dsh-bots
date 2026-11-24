/**
 * `@1outres/dsh-bot-connector-google` (row `bot-connector-google`): Google
 * as a provider of connections, and the Gmail and Google Calendar
 * connectors that act as its accounts. bot-core signs the accounts in and
 * keeps their tokens on the Host; Google's APIs are called from the Host only.
 */
import type { Bot } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { createOwnChanges } from "./host/calendar/own"
import { calendarConnector, gmailConnector } from "./host/connectors"
import { developmentEndpoints, GOOGLE_ENDPOINTS } from "./host/endpoints"
import { createGoogle, type HttpFetch } from "./host/google"
import { googleProvider } from "./host/provider"

export const name = "bot-connector-google"

/**
 * The `bot` service of @1outres/dsh-bot-core. Only types come from that
 * package: a value import would bundle bot-core's runtime into this one.
 */
const BOT = "bot"
export const inject = ["bot"]

function botOf(ctx: Context): Bot {
  const bot = ctx.get(BOT) as Bot | undefined
  if (bot === undefined) throw new Error(`the "${BOT}" service is not available; inject it`)
  return bot
}

/** How long the calendar remembers its own changes, so their events are not told. */
const OWN_CHANGES_MS = 30 * 60_000

export interface Config {
  development: { googleOrigin: string }
}

export const Config: z<Config> = z.object({
  development: z
    .object({
      googleOrigin: z
        .string()
        .default("")
        .description(
          "Development and tests only: an origin serving a fake Google (OAuth, userinfo, Gmail and Calendar under Google's own paths). Empty (the default) uses Google itself. Accounts signed in at one are never refreshed at the other.",
        ),
    })
    .description("Development settings; leave them empty in a real deployment."),
}) as z<Config>

export function apply(ctx: Context, config: Config): void {
  const origin = config.development.googleOrigin.trim()
  const endpoints = origin === "" ? GOOGLE_ENDPOINTS : developmentEndpoints(origin)
  if (endpoints.development) {
    ctx.logger.warn(`bot-connector-google: using the development Google at ${origin}, not Google`)
  }
  const fetchJson: HttpFetch = (url, init) => fetch(url, init)
  const google = createGoogle(endpoints)
  const own = createOwnChanges(Date.now, OWN_CHANGES_MS)
  const bot = botOf(ctx)
  ctx.effect(
    () => bot.registerConnectionProvider(googleProvider(endpoints, fetchJson)),
    "google: provider",
  )
  ctx.effect(() => bot.registerConnector(gmailConnector(google)), "google: gmail connector")
  ctx.effect(
    () => bot.registerConnector(calendarConnector(google, own)),
    "google: calendar connector",
  )
}
