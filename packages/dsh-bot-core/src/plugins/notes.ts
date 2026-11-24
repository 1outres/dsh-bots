/**
 * `@1outres/dsh-bot-core/notes`: bot-core's own row inside every bot's
 * isolated `bot-environment` group (compose.ts puts it after the prompt
 * row; templates and overlays cannot name it). For the bot's Agents it
 * registers note_read, note_write, note_link and note_search, the
 * `bot:pinned-notes` context, and an `agent/pre-step` listener that brings
 * the notes up to date before each step and adds the notice of the notes an
 * owner's message names (docs/specs/bot-notes.md). Every call goes to the
 * `bot` service with the revision's token, which reads and writes the notes
 * through the bot's environment's file system.
 *
 * The context and the listener carry the scope of the preset revision this
 * row is mounted in, so DSH applies them only to that revision's Agents.
 */
import type { Context } from "@deepseek-ai/cordis"
import type { PreStepDecision } from "@deepseek-ai/dsh-agent"
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import { NOTE_TYPES } from "../host/notes/note"
import {
  NOTE_LINK_DESCRIPTION,
  NOTE_NAME_PARAMETER,
  NOTE_READ_DESCRIPTION,
  NOTE_SEARCH_DESCRIPTION,
  NOTE_SEARCH_PARAMETERS,
  NOTE_WRITE_DESCRIPTION,
  NOTE_WRITE_PARAMETERS,
} from "../host/notes/texts"
import { agentIdOf } from "../host/prompt/assembly"
import { PINNED_NOTES_CONTEXT } from "../host/prompt/sections"
import {
  CALL_NOTE_TOOL,
  type CallNoteTool,
  type NoteStepMessage,
  type NoteToolName,
  PINNED_NOTES,
  type PinnedNotes,
  PREPARE_NOTES,
  type PrepareNotes,
} from "../internal"

export interface Config {
  botId: string
  /** The preset revision's token (compose.ts), as every bot-core row carries it. */
  token: string
}

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's notes`)
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

const stepMessage = (message: UserMessage): NoteStepMessage => ({
  fromUser: message.source.kind === "user",
  text: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
})

const LINK_APPLY = {
  oneOf: [
    { type: "string" },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", required: true },
        target: { type: "string", required: true },
      },
    },
  ],
} as const

export default class BotNotes {
  static inject = [BOT_SERVICE, "tools", "systemPrompt"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const call = methodOf<CallNoteTool>(bot, CALL_NOTE_TOOL)
    const prepare = methodOf<PrepareNotes>(bot, PREPARE_NOTES)
    const pinned = methodOf<PinnedNotes>(bot, PINNED_NOTES)

    const register = (name: NoteToolName, description: string, parameters: object) =>
      ctx.effect(
        () =>
          ctx.tools.register(
            defineTool({
              name,
              description,
              parameters: parameters as never,
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
          ),
        `bot-core: ${name} of bot "${config.botId}"`,
      )

    register("note_read", NOTE_READ_DESCRIPTION, {
      note: { type: "string", required: true, description: NOTE_NAME_PARAMETER },
    })
    register("note_write", NOTE_WRITE_DESCRIPTION, {
      action: {
        type: "string",
        enum: ["create", "update", "append"],
        required: true,
        description: NOTE_WRITE_PARAMETERS.action,
      },
      note: { type: "string", description: NOTE_WRITE_PARAMETERS.note },
      title: { type: "string", description: NOTE_WRITE_PARAMETERS.title },
      type: { type: "string", enum: [...NOTE_TYPES], description: NOTE_WRITE_PARAMETERS.type },
      aliases: {
        type: "array",
        items: { type: "string" },
        description: NOTE_WRITE_PARAMETERS.aliases,
      },
      summary: { type: "string", description: NOTE_WRITE_PARAMETERS.summary },
      pinned: { type: "boolean", description: NOTE_WRITE_PARAMETERS.pinned },
      body: { type: "string", description: NOTE_WRITE_PARAMETERS.body },
      edits: {
        type: "array",
        description: NOTE_WRITE_PARAMETERS.edits,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            old: { type: "string", required: true },
            new: { type: "string", required: true },
          },
        },
      },
      text: { type: "string", description: NOTE_WRITE_PARAMETERS.text },
    })
    register("note_link", NOTE_LINK_DESCRIPTION, {
      note: { type: "string", required: true, description: NOTE_NAME_PARAMETER },
      apply: {
        required: true,
        description:
          'A suggestion number such as "L1", { "id": "L2", "target": "<title>" }, or a list of them.',
        oneOf: [...LINK_APPLY.oneOf, { type: "array", items: LINK_APPLY }],
      },
    })
    register("note_search", NOTE_SEARCH_DESCRIPTION, {
      query: { type: "string", required: true, description: NOTE_SEARCH_PARAMETERS.query },
      type: { type: "string", enum: [...NOTE_TYPES], description: NOTE_SEARCH_PARAMETERS.type },
      limit: { type: "integer", description: NOTE_SEARCH_PARAMETERS.limit },
    })

    ctx.systemPrompt.context({
      name: PINNED_NOTES_CONTEXT.name,
      order: PINNED_NOTES_CONTEXT.order,
      interpolate: false,
      text: (context) => pinned(config.botId, config.token, agentIdOf(context)),
    })

    ctx.on("agent/pre-step", async (payload, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === "reject") return decision
      const notice = await prepare(
        config.botId,
        config.token,
        { agentId: payload.agent.id, messages: payload.messages.map(stepMessage) },
        payload.signal,
      )
      payload.signal.throwIfAborted()
      if (notice === undefined) return decision
      const message = createUserMessage({
        content: [{ type: "text", text: notice.text }],
        source: { kind: "bot-notes", form: "notice", summary: notice.summary },
      })
      const claimed = decision.messages.map((entry) => payload.messages.includes(entry))
      const after = claimed.lastIndexOf(true) + 1
      return {
        ...decision,
        messages: [
          ...decision.messages.slice(0, after),
          message,
          ...decision.messages.slice(after),
        ],
      }
    })
  }
}
