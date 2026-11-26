import type { Context } from "@deepseek-ai/cordis"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import { CREDENTIALS_LIST_DESCRIPTION, CREDENTIALS_LIST_TOOL } from "../host/vaults/texts"
import {
  CREDENTIALS_AVAILABLE,
  type CredentialsAvailable,
  LIST_CREDENTIALS,
  type ListCredentials,
} from "../internal"

export interface Config {
  botId: string
  token: string
}

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot list a bot's logins`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
}

export default class BotVaultTools {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const available = methodOf<CredentialsAvailable>(bot, CREDENTIALS_AVAILABLE)
    const list = methodOf<ListCredentials>(bot, LIST_CREDENTIALS)
    ctx.effect(
      () =>
        ctx.tools.register(
          defineTool({
            name: CREDENTIALS_LIST_TOOL,
            description: CREDENTIALS_LIST_DESCRIPTION,
            parameters: {},
            output: {
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  text: { type: "string", required: true },
                  data: { type: "json" },
                },
              },
              render: (_args: unknown, value: { text: string }) => [
                { type: "text" as const, text: value.text },
              ],
            },
            async execute(_args, exec) {
              if (exec.agent === undefined) {
                throw new ToolContextUnavailableError(
                  `${CREDENTIALS_LIST_TOOL} requires the calling Agent`,
                )
              }
              const answer = await list(config.botId, config.token, exec.agent.id, exec.signal)
              return { text: answer.text, data: answer.data as never }
            },
          }),
          {
            when: ({ agent }: { readonly agent: { readonly id: string } }) =>
              available(config.botId, config.token, agent.id),
          },
        ),
      `bot-core: credentials_list of bot "${config.botId}"`,
    )
  }
}
