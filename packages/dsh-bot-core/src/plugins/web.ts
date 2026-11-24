/**
 * `@1outres/dsh-bot-core/web`: bot-core's own row inside every bot's
 * isolated `bot-environment` group, after the group's `@deepseek-ai/dsh-web`
 * row (`env-bot-core-web`, which selects the provider id "bot-core"; compose.ts
 * places both, templates and overlays cannot name them). For each capability
 * the composition offers, it registers that provider on the group's web seam
 * and hands every call to the `bot` service with the revision's token, which
 * runs it through the web backend the settings name (design rule 45).
 * Readiness reads only whether the backend's secrets are stored, so tool-web
 * shows a tool from the step its key is set.
 */
import type { Context } from "@deepseek-ai/cordis"
import {
  WebError,
  type WebFetchProvider,
  type WebFetchRequest,
  type WebFetchResult,
  type WebSearchProvider,
  type WebSearchRequest,
  type WebSearchResult,
} from "@deepseek-ai/dsh-web"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import {
  WEB_FETCH,
  WEB_READY,
  WEB_SEARCH,
  type WebOperation,
  type WebOutcome,
  type WebReady,
} from "../internal"
import { WEB_PROVIDER_ID } from "../shared/web"

export interface Config {
  botId: string
  /** The preset revision's token (compose.ts). */
  token: string
  /** The web backend the composition was made for. */
  backend: string
  search: boolean
  fetch: boolean
}

/** The slice of the group's `web` service (dsh-web `WebRuntime`) this row uses. */
interface GroupWeb {
  registerSearchProvider(provider: WebSearchProvider): () => void
  registerFetchProvider(provider: WebFetchProvider): () => void
}

const TITLE = "Bot web lookup (dsh-bots)"

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's web lookup`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
}

function resultOf<Result>(outcome: WebOutcome<Result>): Result {
  if (outcome.ok) return outcome.result
  throw new WebError(outcome.refusal.message, outcome.refusal.code)
}

export default class BotWebBridge {
  static inject = [BOT_SERVICE, "web"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
    backend: z.string().required().description("The web backend the composition was made for."),
    search: z.boolean().required().description("Whether this revision offers web search."),
    fetch: z.boolean().required().description("Whether this revision offers web fetch."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const web = ctx.get("web") as GroupWeb
    const ready = methodOf<WebReady>(bot, WEB_READY)
    const search = methodOf<WebOperation<WebSearchRequest, WebSearchResult>>(bot, WEB_SEARCH)
    const fetch = methodOf<WebOperation<WebFetchRequest, WebFetchResult>>(bot, WEB_FETCH)
    const { botId, token } = config
    const signalOf = (signal: AbortSignal | undefined) => signal ?? new AbortController().signal
    if (config.search) {
      web.registerSearchProvider({
        id: WEB_PROVIDER_ID,
        title: TITLE,
        available: () => true,
        ready: () => ready(botId, token, "search"),
        search: async (request: WebSearchRequest, signal?: AbortSignal) =>
          resultOf(await search(botId, token, request, signalOf(signal))),
      })
    }
    if (config.fetch) {
      web.registerFetchProvider({
        id: WEB_PROVIDER_ID,
        title: TITLE,
        available: () => true,
        ready: () => ready(botId, token, "fetch"),
        fetch: async (request: WebFetchRequest, signal?: AbortSignal) =>
          resultOf(await fetch(botId, token, request, signalOf(signal))),
      })
    }
  }
}
