import type { Context } from "@deepseek-ai/cordis"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import {
  CALL_PEER_TOOL,
  type CallPeerTool,
  PEER_TOOL_AVAILABLE,
  type PeerToolAvailable,
} from "../internal"

export interface Config {
  botId: string
  token: string
}

export const PEER_SEND_DESCRIPTION =
  'Send a message to a peer bot: another bot of your owner in the same group as you (the context lists them under "Peer bots"; without that list you are in no group). ' +
  "It is asynchronous: the message reaches the peer's Main session after its current turn, and a reply, if any, comes back here later as a [peer] notice; do not wait for it in this turn. " +
  "Write a message that stands on its own. Reply to a peer's message once, with reply_to; do not reply to thanks or acknowledgements, and set expects_reply to false when you need nothing back. " +
  "Never put your owner's private information in a message unless your owner agreed. " +
  "Messages are limited per thread, per pair of bots, per group and per hour; when one is refused for a limit or a pause, do not try another way."

export const PEER_SEND_PARAMETERS = {
  to: {
    type: "string",
    required: true,
    description: 'The peer bot\'s id, as listed under "Peer bots" (not its name).',
  },
  message: {
    type: "string",
    required: true,
    description: "The message, 1 to 4,000 characters; it may span several lines.",
  },
  reply_to: {
    type: "string",
    description:
      "To reply: the id of the message this peer sent you (from its [peer] notice). Leave it out to start a new thread.",
  },
  expects_reply: {
    type: "boolean",
    description:
      "Whether you need a reply. Defaults to true for a new thread and to false for a reply.",
  },
} as const

const OUTPUT = {
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
} as const

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's peer_send tool`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
}

export default class BotPeerTools {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const available = methodOf<PeerToolAvailable>(bot, PEER_TOOL_AVAILABLE)
    const call = methodOf<CallPeerTool>(bot, CALL_PEER_TOOL)
    ctx.effect(
      () =>
        ctx.tools.register(
          defineTool({
            name: "peer_send",
            description: PEER_SEND_DESCRIPTION,
            parameters: PEER_SEND_PARAMETERS as never,
            output: OUTPUT,
            async execute(args, exec) {
              if (exec.agent === undefined) {
                throw new ToolContextUnavailableError("peer_send requires the calling Agent")
              }
              const response = await call(config.botId, config.token, {
                agentId: exec.agent.id,
                args,
              })
              return { text: response.text, data: response.data as never }
            },
          }),
          {
            when: ({ agent }: { readonly agent: { readonly id: string } }) =>
              available(config.botId, config.token, agent.id),
          },
        ),
      `bot-core: peer_send of bot "${config.botId}"`,
    )
  }
}
