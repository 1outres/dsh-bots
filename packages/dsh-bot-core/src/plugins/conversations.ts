import type { Context } from "@deepseek-ai/cordis"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import {
  CONVERSATION_READ_DESCRIPTION,
  CONVERSATION_READ_PARAMETERS,
  CONVERSATION_SEARCH_DESCRIPTION,
  CONVERSATION_SEARCH_PARAMETERS,
} from "../host/conversations/texts"
import {
  CALL_CONVERSATION_TOOL,
  type CallConversationTool,
  CONVERSATION_TOOLS_AVAILABLE,
  type ConversationToolName,
  type ConversationToolsAvailable,
} from "../internal"

export interface Config {
  botId: string
  token: string
}

export const CONVERSATION_TOOLS: {
  readonly [Tool in ConversationToolName]: {
    readonly description: string
    readonly parameters: Record<string, unknown>
  }
} = {
  conversation_search: {
    description: CONVERSATION_SEARCH_DESCRIPTION,
    parameters: {
      query: { type: "string", required: true, description: CONVERSATION_SEARCH_PARAMETERS.query },
      after: { type: "string", description: CONVERSATION_SEARCH_PARAMETERS.after },
      before: { type: "string", description: CONVERSATION_SEARCH_PARAMETERS.before },
      limit: { type: "integer", description: CONVERSATION_SEARCH_PARAMETERS.limit },
    },
  },
  conversation_read: {
    description: CONVERSATION_READ_DESCRIPTION,
    parameters: {
      session: {
        type: "string",
        required: true,
        description: CONVERSATION_READ_PARAMETERS.session,
      },
      message: {
        type: "integer",
        required: true,
        description: CONVERSATION_READ_PARAMETERS.message,
      },
      earlier: { type: "integer", description: CONVERSATION_READ_PARAMETERS.earlier },
      later: { type: "integer", description: CONVERSATION_READ_PARAMETERS.later },
    },
  },
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

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's past conversations`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
}

export default class BotConversationTools {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const available = methodOf<ConversationToolsAvailable>(bot, CONVERSATION_TOOLS_AVAILABLE)
    const call = methodOf<CallConversationTool>(bot, CALL_CONVERSATION_TOOL)
    const when = ({ agent }: { readonly agent: { readonly id: string } }) =>
      available(config.botId, config.token, agent.id)
    for (const [name, tool] of Object.entries(CONVERSATION_TOOLS) as [
      ConversationToolName,
      (typeof CONVERSATION_TOOLS)[ConversationToolName],
    ][]) {
      ctx.effect(
        () =>
          ctx.tools.register(
            defineTool({
              name,
              description: tool.description,
              parameters: tool.parameters as never,
              output: OUTPUT,
              async execute(args, exec) {
                if (exec.agent === undefined) {
                  throw new ToolContextUnavailableError(`${name} requires the calling Agent`)
                }
                return call(
                  config.botId,
                  config.token,
                  { agentId: exec.agent.id, tool: name, args },
                  exec.signal,
                )
              },
            }),
            { when },
          ),
        `bot-core: ${name} of bot "${config.botId}"`,
      )
    }
  }
}
