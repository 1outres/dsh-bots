import type { Context } from "@deepseek-ai/cordis"
import {
  type JsonSchemaNode,
  ToolContextUnavailableError,
  type ToolDefinition,
} from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import {
  CALL_CONNECTOR_TOOL,
  type CallConnectorTool,
  CONNECTOR_TOOL_AVAILABLE,
  type ConnectorToolAvailable,
  type ConnectorToolDescription,
  WATCH_CONNECTOR_TOOLS,
  type WatchConnectorTools,
} from "../internal"

export interface Config {
  botId: string
  token: string
}

interface Registered {
  readonly description: ConnectorToolDescription
  readonly dispose: () => void
}

type ToolOutput = ToolDefinition["output"]
type ContentBlocks = ReturnType<ToolOutput["render"]>

const OUTPUT_SCHEMA: JsonSchemaNode = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: { type: "string" },
    data: {},
    images: { type: "array", items: {} },
  },
}

const render = (_args: unknown, value: unknown): ContentBlocks => {
  const { text, images } = value as { text: string; images?: readonly object[] }
  return [
    { type: "text", text },
    ...(images ?? []).map((attachment) => ({ type: "image", attachment })),
  ] as ContentBlocks
}

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's connector tools`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
}

export default class BotConnectorTools {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const watch = methodOf<WatchConnectorTools>(bot, WATCH_CONNECTOR_TOOLS)
    const available = methodOf<ConnectorToolAvailable>(bot, CONNECTOR_TOOL_AVAILABLE)
    const call = methodOf<CallConnectorTool>(bot, CALL_CONNECTOR_TOOL)
    const register = (description: ConnectorToolDescription) => {
      const definition: ToolDefinition = {
        name: description.name,
        description: description.description,
        parameters: description.parameters as Record<string, unknown>,
        output: { schema: OUTPUT_SCHEMA, render },
        async execute(args, exec) {
          if (exec.agent === undefined) {
            throw new ToolContextUnavailableError(`${description.name} requires the calling Agent`)
          }
          const response = await call(
            config.botId,
            config.token,
            { agentId: exec.agent.id, name: description.name, args },
            exec.signal,
          )
          return {
            text: response.text,
            ...(response.data === undefined ? {} : { data: response.data }),
            ...(response.images === undefined || response.images.length === 0
              ? {}
              : { images: response.images }),
          }
        },
      }
      return ctx.tools.register(definition, {
        when: ({ agent }) => available(config.botId, config.token, agent.id, description.name),
      })
    }
    ctx.effect(() => {
      const registered = new Map<string, Registered>()
      const off = watch(config.botId, config.token, (descriptions) => {
        const wanted = new Map(descriptions.map((description) => [description.name, description]))
        for (const [name, entry] of [...registered]) {
          const next = wanted.get(name)
          if (
            next?.description === entry.description.description &&
            next.parameters === entry.description.parameters
          ) {
            continue
          }
          entry.dispose()
          registered.delete(name)
        }
        for (const [name, description] of wanted) {
          if (registered.has(name)) continue
          registered.set(name, { description, dispose: register(description) })
        }
      })
      return () => {
        off()
        for (const entry of registered.values()) entry.dispose()
        registered.clear()
      }
    }, `bot-core: connector tools of bot "${config.botId}"`)
  }
}
