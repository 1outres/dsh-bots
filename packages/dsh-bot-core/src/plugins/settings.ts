import type { Context } from "@deepseek-ai/cordis"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import {
  SETTINGS_ACTIONS,
  SETTINGS_TOOL,
  SETTINGS_TOOL_DESCRIPTION,
  SETTINGS_TOOL_PARAMETERS,
} from "../host/settings/texts"
import {
  CALL_SETTINGS_TOOL,
  type CallSettingsTool,
  SETTINGS_TOOL_AVAILABLE,
  type SettingsToolAvailable,
} from "../internal"

export interface Config {
  botId: string
  token: string
}

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's settings`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
}

const OUTPUT = {
  schema: {
    type: "object",
    additionalProperties: false,
    properties: { text: { type: "string", required: true } },
  },
  render: (_args: unknown, value: { text: string }) => [
    { type: "text" as const, text: value.text },
  ],
} as const

export default class BotSettingsTool {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const available = methodOf<SettingsToolAvailable>(bot, SETTINGS_TOOL_AVAILABLE)
    const call = methodOf<CallSettingsTool>(bot, CALL_SETTINGS_TOOL)
    const { botId, token } = config
    ctx.effect(
      () =>
        ctx.tools.register(
          defineTool({
            name: SETTINGS_TOOL,
            description: SETTINGS_TOOL_DESCRIPTION,
            parameters: {
              action: {
                type: "string",
                enum: [...SETTINGS_ACTIONS],
                required: true,
                description: SETTINGS_TOOL_PARAMETERS.action,
              },
              area: { type: "string", description: SETTINGS_TOOL_PARAMETERS.area },
              changes: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    key: { type: "string", required: true },
                    value: { type: "json", required: true },
                  },
                },
                description: SETTINGS_TOOL_PARAMETERS.changes,
              },
              reason: { type: "string", description: SETTINGS_TOOL_PARAMETERS.reason },
            },
            output: OUTPUT,
            async execute(args, exec) {
              if (exec.agent === undefined) {
                throw new ToolContextUnavailableError(`${SETTINGS_TOOL} requires the calling Agent`)
              }
              return call(botId, token, { agentId: exec.agent.id, args }, exec.signal)
            },
          }),
          { when: ({ agent }) => available(botId, token, agent.id) },
        ),
      `bot-core: ${SETTINGS_TOOL} of bot "${botId}"`,
    )
  }
}
