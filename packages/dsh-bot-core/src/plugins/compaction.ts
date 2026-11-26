import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE } from "../contract"
import { ATTACH_COMPACTION, type AttachCompaction } from "../internal"

export interface Config {
  botId: string
  token: string
}

interface CompactionEngine {
  compactNow(agent: object, signal: AbortSignal): Promise<unknown>
}

export default class BotCompaction {
  static inject = [BOT_SERVICE, "compaction"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const engine = ctx.get("compaction") as CompactionEngine | undefined
    if (engine === undefined) throw new Error("this realm has no compaction")
    ctx.effect(() => {
      const bot: unknown = ctx.get(BOT_SERVICE)
      const attach: unknown =
        typeof bot === "object" && bot !== null ? Reflect.get(bot, ATTACH_COMPACTION) : undefined
      if (typeof attach !== "function") {
        throw new Error(`the "${BOT_SERVICE}" service cannot take a bot's compaction`)
      }
      return (attach as AttachCompaction).call(bot, config.botId, config.token, {
        compactNow: async (agent, signal) => (await engine.compactNow(agent, signal)) !== null,
      })
    }, `bot-core: compaction of bot "${config.botId}"`)
  }
}
