import type { Bot, BotWebBackend } from "@1outres/dsh-bot-core"
import type { Context } from "@deepseek-ai/cordis"
import { WebError } from "@deepseek-ai/dsh-web"
import z from "@deepseek-ai/schemastery"
import { createExa, EXA_OPTIONS, type Exa } from "./exa"

export const name = "bot-web"
export const inject = ["bot"]

export interface Config {
  baseURL: string
}

export const Config: z<Config> = z.object({
  baseURL: z
    .string()
    .default(EXA_OPTIONS.baseURL)
    .hidden()
    .description(
      "Exa API base URL. Change it only to point a verification profile at a fake Exa API.",
    ),
}) as z<Config>

export const EXA_BACKEND_ID = "exa"
export const EXA_API_KEY = "apiKey"

export function exaBackend(exa: Exa): BotWebBackend {
  const callOf = (call: {
    readonly secrets: Readonly<Record<string, string>>
    readonly signal: AbortSignal
  }) => {
    const apiKey = call.secrets[EXA_API_KEY]
    if (apiKey === undefined) {
      throw new WebError("the bots' Exa API key is not set", "WEB_PROVIDER_CREDENTIAL_MISSING")
    }
    return { apiKey, signal: call.signal }
  }
  return {
    id: EXA_BACKEND_ID,
    name: { en: "Exa", ja: "Exa" },
    description: {
      en: "Searches with Exa and reads pages through Exa's servers (not from the bot's VM or the Host). Each search, page read and connection test is billed to the Exa account of the key.",
      ja: "Exa で検索し、ページは Exa のサーバーが取りに行きます（ボットの VM や Host からではありません）。検索・ページの取得・接続テストはそれぞれ、キーの Exa アカウントに課金されます。",
    },
    secrets: [{ key: EXA_API_KEY, label: { en: "Exa API key", ja: "Exa の API キー" } }],
    search: { placement: "host", run: (request, call) => exa.search(request, callOf(call)) },
    fetch: { placement: "host", run: (request, call) => exa.fetch(request, callOf(call)) },
    test: (call) => exa.test(callOf(call)),
  }
}

export function apply(ctx: Context, config: Config): void {
  const bot = ctx.get("bot") as Bot
  const exa = createExa({
    options: { ...EXA_OPTIONS, baseURL: config.baseURL },
    fetch: (url, init) => globalThis.fetch(url, init),
    warn: (message) => ctx.logger.warn(message),
  })
  ctx.effect(() => bot.registerWebBackend(exaBackend(exa)), "bot-web: Exa backend")
}
