/**
 * `@1outres/dsh-bot-core/compaction`: bot-core's own row in every bot's
 * preset, inside the group that isolates the bot's `compaction` (compose.ts
 * places it; without such a group it sits in the `bot-environment` group,
 * whose compaction is then the one the bot's Agents use). While the revision
 * is mounted it hands that realm's `compactNow` to the `bot` service with its
 * token, for compacting an idle Main (docs/specs/bot-main-rotation.md).
 */
import type { Context } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE } from "../contract"
import { ATTACH_COMPACTION, type AttachCompaction } from "../internal"

export interface Config {
  botId: string
  /** The preset revision's token (compose.ts); bot-core ignores rows of other revisions. */
  token: string
}

/** DSH's `CompactionEngine`, as far as used here. */
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
