/**
 * `@1outres/dsh-bot-core/files`: bot-core's own row inside every bot's
 * isolated `bot-environment` group (compose.ts puts it right after the
 * environment's rows; templates and overlays cannot name it).
 *
 * While the bot's preset revision is mounted, and so whether or not any Agent
 * runs it, the row hands the group's `fs` and `subprocess` to the `bot`
 * service (src/internal.ts) with its revision's token; bot-core serves the
 * `botFiles` Remote only with those of the registered revision's token. Fail closed: a
 * service is handed over only when it lives in a realm this row's group
 * isolates; outside such a group (a misplaced row) both getters return
 * undefined, so the Host's file system is never reached.
 */
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE } from "../contract"
import { ATTACH_ENVIRONMENT_SERVICES, type AttachEnvironmentServices } from "../internal"

/** `Context.isolate` of `@deepseek-ai/cordis`, a registered symbol. */
const ISOLATE: unique symbol = Symbol.for("cordis.isolate") as never

export interface Config {
  botId: string
  /** The preset revision's token (compose.ts); bot-core ignores rows of other revisions. */
  token: string
}

/** The realm key `ctx` resolves `name` with. */
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
    /** The service of this group's own realm, never one inherited from the Host. */
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
