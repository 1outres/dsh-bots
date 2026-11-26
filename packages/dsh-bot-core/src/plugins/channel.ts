import type { Context } from "@deepseek-ai/cordis"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import { STAY_CHANNEL_SILENT, type StayChannelSilent } from "../internal"

export interface Config {
  botId: string
  token: string
}

const STAY_SILENT_DESCRIPTION =
  "Keep the rest of this turn off the chat channels connected to you (such as Discord): " +
  "text in the same message as this call, and what you write or present after it, stays in your session and is not sent to the user. " +
  "Works only in your Main session. " +
  "Text from your earlier messages of the turn has already been delivered and cannot be taken back. " +
  "The next turn is sent as usual."

function internalMethod<T>(bot: Bot, key: symbol, what: string): T {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot ${what}`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
}

export default class BotChannelTools {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const staySilent = internalMethod<StayChannelSilent>(
      bot,
      STAY_CHANNEL_SILENT,
      "keep a bot's turn off its channels",
    )
    ctx.effect(
      () =>
        ctx.tools.register(
          defineTool({
            name: "stay_silent",
            description: STAY_SILENT_DESCRIPTION,
            parameters: {
              reason: {
                type: "string",
                description: "Why this turn has nothing for the user; shown only in your session.",
              },
            },
            output: {
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  turn: { type: "integer", required: true },
                },
              },
              render: () => [
                {
                  type: "text",
                  text: "The rest of this turn stays off your chat channels; nothing more of it reaches the user.",
                },
              ],
            },
            async execute(_args, exec) {
              if (exec.agent === undefined) {
                throw new ToolContextUnavailableError("stay_silent requires the calling Agent")
              }
              return staySilent(config.botId, config.token, { agentId: exec.agent.id })
            },
          }),
        ),
      `bot-core: stay_silent of bot "${config.botId}"`,
    )
  }
}
