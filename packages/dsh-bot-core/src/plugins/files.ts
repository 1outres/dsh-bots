import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE } from "../contract"
import { ATTACH_ENVIRONMENT_SERVICES, type AttachEnvironmentServices } from "../internal"

const ISOLATE: unique symbol = Symbol.for("cordis.isolate") as never

export interface Config {
  botId: string
  token: string
}

function realmOf(ctx: object, name: string): unknown {
  const realms: unknown = Reflect.get(ctx, ISOLATE)
  return typeof realms === "object" && realms !== null ? Reflect.get(realms, name) : undefined
}

export default class BotEnvironmentFiles {
  static inject = [BOT_SERVICE]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const isolated = (name: string): object | undefined => {
      const own = realmOf(ctx, name)
      if (own === undefined || own === realmOf(ctx.root, name)) return undefined
      const service: unknown = ctx.get(name)
      return typeof service === "object" && service !== null ? service : undefined
    }
    ctx.effect(() => {
      const bot: unknown = ctx.get(BOT_SERVICE)
      const attach: unknown =
        typeof bot === "object" && bot !== null
          ? Reflect.get(bot, ATTACH_ENVIRONMENT_SERVICES)
          : undefined
      if (typeof attach !== "function") {
        throw new Error(`the "${BOT_SERVICE}" service cannot take a bot's environment services`)
      }
      return (attach as AttachEnvironmentServices).call(bot, config.botId, config.token, {
        fs: () => isolated("fs"),
        subprocess: () => isolated("subprocess"),
      })
    }, `bot-core: environment files of bot "${config.botId}"`)
  }
}
