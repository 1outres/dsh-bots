/**
 * `@1outres/dsh-bot-core/sessions`: bot-core's own row inside every bot's
 * isolated `bot-environment` group (compose.ts puts it after the schedule
 * row; templates and overlays cannot name it). It registers the session
 * tools (docs/specs/bot-managed-sessions.md §5), shown only to the bot's
 * Main session, and passes every call to the `bot` service with the
 * revision's token.
 */
import type { Context } from "@deepseek-ai/cordis"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import {
  CALL_SESSION_TOOL,
  type CallSessionTool,
  SESSION_TOOLS_AVAILABLE,
  type SessionToolName,
  type SessionToolsAvailable,
} from "../internal"

export interface Config {
  botId: string
  /** The preset revision's token (compose.ts); bot-core refuses calls of other revisions. */
  token: string
}

const SESSION_ID = {
  type: "string",
  required: true,
  description: "The managed session (see session_list).",
} as const

/** What each tool says and takes; the parameters are DSH's JSON Schema subset. */
export const SESSION_TOOLS: {
  readonly [Tool in SessionToolName]: {
    readonly description: string
    readonly parameters: Record<string, unknown>
  }
} = {
  session_start: {
    description:
      "Start a session to carry out a task apart from this conversation, and manage it: in your own environment, or in a DSH Workspace your owner granted you (see session_list). Its instruction must stand on its own (the session does not see this conversation). " +
      "It starts working at once; each time its turn ends or it asks a question, a [session] notice reaches you, and you read it with session_read. " +
      "Your owner sees the session in the Web UI and may write in it too.",
    parameters: {
      target: {
        type: "string",
        required: true,
        description:
          'Where it runs: "bot" is your own machine and setup; "workspace:<id>" is a Workspace your owner granted you, with the Agent preset and permissions your owner set for it.',
      },
      title: {
        type: "string",
        required: true,
        description: "A short title, shown in the session list.",
      },
      instruction: { type: "string", required: true, description: "The task, complete in itself." },
      model: {
        type: "string",
        description:
          "One of your delegate models as session_list names it; omit it for your main model (bot) or the Workspace's model (workspace).",
      },
      answerer: {
        type: "string",
        enum: ["main", "owner"],
        description:
          "Who answers the questions it asks: main (you, with session_answer) or owner (your owner, in the Web UI). The default is main for bot and owner for a Workspace. Approvals are always your owner's.",
      },
    },
  },
  session_send: {
    description:
      "Send a message to a session you manage. mode queue (default) gives it its own turn after the running one; steer adds it to the running turn at its next step.",
    parameters: {
      session_id: SESSION_ID,
      message: { type: "string", required: true },
      mode: { type: "string", enum: ["queue", "steer"] },
    },
  },
  session_read: {
    description:
      "Read a session you manage: whether it is running, idle or waiting for an answer, the questions waiting (with their ids), and its messages after a cursor (the cursor a previous read returned; omit it for the latest ones).",
    parameters: {
      session_id: SESSION_ID,
      after: { type: "string", description: "The cursor of a previous session_read." },
      limit: {
        type: "integer",
        description: "At most this many messages, the newest ones; default 10, at most 50.",
      },
    },
  },
  session_answer: {
    description:
      "Answer a question or a plan review waiting in a session you manage, when its questions are yours to answer (see session_read for the interaction id and the question ids).",
    parameters: {
      session_id: SESSION_ID,
      interaction_id: { type: "string", required: true },
      answers: {
        type: "array",
        description:
          "For questions: one answer per question, with the chosen option labels and/or a text answer.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", required: true },
            selected: { type: "array", items: { type: "string" }, required: true },
            custom: { type: "string" },
          },
        },
      },
      approved: {
        type: "boolean",
        description: "For a plan review: approve (true) or reject (false).",
      },
      feedback: { type: "string", description: "For a rejected plan: what to change." },
    },
  },
  session_stop: {
    description:
      "Stop the running turn of a session you manage. Its messages stay; send it more later if needed.",
    parameters: { session_id: SESSION_ID },
  },
  session_list: {
    description:
      "List the sessions you manage (started by you or handed over by your owner), with who answers their questions and their state, the Workspaces granted to you, and the models session_start can use.",
    parameters: {},
  },
  session_release: {
    description:
      "Stop managing a session when its work is done; archive: true also archives it (stopping what it still runs). Your owner can still open it in the Web UI.",
    parameters: {
      session_id: SESSION_ID,
      archive: { type: "boolean" },
    },
  },
}

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
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's session tools`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
}

export default class BotSessionTools {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const available = methodOf<SessionToolsAvailable>(bot, SESSION_TOOLS_AVAILABLE)
    const call = methodOf<CallSessionTool>(bot, CALL_SESSION_TOOL)
    const when = ({ agent }: { readonly agent: { readonly id: string } }) =>
      available(config.botId, config.token, agent.id)
    for (const [name, tool] of Object.entries(SESSION_TOOLS) as [
      SessionToolName,
      (typeof SESSION_TOOLS)[SessionToolName],
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
                const response = await call(config.botId, config.token, {
                  agentId: exec.agent.id,
                  tool: name,
                  args,
                })
                return { text: response.text, data: response.data as never }
              },
            }),
            { when },
          ),
        `bot-core: ${name} of bot "${config.botId}"`,
      )
    }
  }
}
