import type { Context } from "@deepseek-ai/cordis"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import {
  SPACE_TOOL_PARAMETERS as P,
  SPACE_TOOL_DESCRIPTIONS,
  SPACE_TOOL_NAMES,
  type SpaceToolName,
} from "../host/spaces/texts"
import {
  CALL_SPACE_TOOL,
  type CallSpaceTool,
  SPACE_TOOLS_AVAILABLE,
  type SpaceToolsAvailable,
} from "../internal"

export interface Config {
  botId: string
  token: string
}

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's Spaces`)
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

const space = { type: "string", required: true, description: P.space } as const
const reason = { type: "string", required: true, description: P.reason } as const

const PARAMETERS = {
  space_create: {
    space,
    title: { type: "string", required: true, description: P.title },
    description: { type: "string", description: P.description },
    pinned: { type: "boolean", description: P.pinned },
  },
  space_publish: { space },
  space_update: {
    space,
    title: { type: "string", description: P.title },
    description: { type: "string", description: P.description },
    pinned: { type: "boolean", description: P.pinned },
  },
  space_list: {},
  space_delete: { space },
  space_kv_get: {
    space,
    key: { type: "string", description: P.key },
    prefix: { type: "string", description: P.prefix },
  },
  space_kv_set: {
    space,
    entries: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", required: true },
          value: { type: "json", required: true },
        },
      },
      description: P.entries,
    },
    delete: { type: "array", items: { type: "string" }, description: P.delete },
  },
  space_post: {
    space,
    name: { type: "string", required: true, description: P.name },
    data: { type: "json", description: P.data },
  },
  space_link: { space, days: { type: "integer", description: P.days }, reason },
  space_visibility: {
    space,
    visibility: {
      type: "string",
      enum: ["owner", "public"],
      required: true,
      description: P.visibility,
    },
    reason,
  },
  space_visitor_writes: {
    space,
    allowed: { type: "boolean", required: true, description: P.allowed },
    reason,
  },
} as const satisfies Record<SpaceToolName, object>

export default class BotSpacesTools {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const available = methodOf<SpaceToolsAvailable>(bot, SPACE_TOOLS_AVAILABLE)
    const call = methodOf<CallSpaceTool>(bot, CALL_SPACE_TOOL)
    const { botId, token } = config
    for (const name of SPACE_TOOL_NAMES) {
      ctx.effect(
        () =>
          ctx.tools.register(
            defineTool({
              name,
              description: SPACE_TOOL_DESCRIPTIONS[name],
              parameters: PARAMETERS[name],
              output: OUTPUT,
              async execute(args, exec) {
                if (exec.agent === undefined) {
                  throw new ToolContextUnavailableError(`${name} requires the calling Agent`)
                }
                return call(botId, token, { agentId: exec.agent.id, tool: name, args }, exec.signal)
              },
            }),
            { when: ({ agent }) => available(botId, token, agent.id) },
          ),
        `bot-core: ${name} of bot "${botId}"`,
      )
    }
  }
}
