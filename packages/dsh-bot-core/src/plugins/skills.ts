/**
 * `@1outres/dsh-bot-core/skills`: bot-core's own row inside every bot's
 * isolated `bot-environment` group (compose.ts puts it after the notes row
 * and the group's own `@deepseek-ai/dsh-skill`; templates and overlays cannot
 * name it). For the bot's Agents it registers the only provider of the
 * group's skill registry, the bot's skills/ (docs/specs/bot-skills.md §2),
 * the skill_manage tool (shown only where the `bot` service lets an Agent
 * change skills), and an `agent/pre-step` listener that reads skills/ again
 * before each step, so a change made with bash reaches the catalog.
 *
 * The listener and the registrations carry the scope of the preset revision
 * this row is mounted in, so DSH applies them only to that revision's Agents.
 */
import type { Context } from "@deepseek-ai/cordis"
import type { PreStepDecision } from "@deepseek-ai/dsh-agent"
import type { SkillCandidate, SkillDefinition } from "@deepseek-ai/dsh-skill"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import { SKILL_ACTIONS, SKILL_MANAGE_TOOL } from "../host/skills/manage"
import { SKILL_MANAGE_DESCRIPTION, SKILL_MANAGE_PARAMETERS } from "../host/skills/texts"
import {
  type BotSkillEntry,
  CALL_SKILL_TOOL,
  type CallSkillTool,
  LIST_SKILLS,
  type ListSkills,
  LOAD_SKILL,
  type LoadSkill,
  PREPARE_SKILLS,
  type PrepareSkills,
  SKILL_TOOL_AVAILABLE,
  type SkillToolAvailable,
  WATCH_SKILLS,
  type WatchSkills,
} from "../internal"

export interface Config {
  botId: string
  /** The preset revision's token (compose.ts), as every bot-core row carries it. */
  token: string
}

/** The provider name of the bot's skills in its group's registry. */
export const SKILL_PROVIDER = "bot-skills"

const methodOf = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's skills`)
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

const summaryOf = (entry: BotSkillEntry) => ({
  name: entry.name,
  description: entry.description,
  invocation: { modelInvocable: true, userInvocable: true },
  source: "bot-workspace",
  provider: SKILL_PROVIDER,
  resourceBase: { kind: "directory" as const, path: entry.directory },
})

const lookupSignal = (signal: AbortSignal | undefined) => signal ?? new AbortController().signal

export default class BotSkills {
  static inject = [BOT_SERVICE, "tools", "skills"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const available = methodOf<SkillToolAvailable>(bot, SKILL_TOOL_AVAILABLE)
    const call = methodOf<CallSkillTool>(bot, CALL_SKILL_TOOL)
    const prepare = methodOf<PrepareSkills>(bot, PREPARE_SKILLS)
    const list = methodOf<ListSkills>(bot, LIST_SKILLS)
    const load = methodOf<LoadSkill>(bot, LOAD_SKILL)
    const watch = methodOf<WatchSkills>(bot, WATCH_SKILLS)
    const { botId, token } = config

    ctx.effect(
      () =>
        ctx.skills.registerProvider((control) => {
          const stop = watch(botId, token, () => control.invalidate())
          control.signal.addEventListener("abort", stop, { once: true })
          return {
            name: SKILL_PROVIDER,
            async list(options): Promise<SkillCandidate[]> {
              const entries = await list(botId, token, lookupSignal(options.signal))
              return entries.map((entry) => ({
                ...summaryOf(entry),
                rank: 100,
                locator: entry.name,
              }))
            },
            async get(candidate, options): Promise<SkillDefinition | undefined> {
              const loaded = await load(botId, token, candidate.name, lookupSignal(options.signal))
              return loaded === undefined
                ? undefined
                : { ...summaryOf(loaded), content: loaded.content }
            },
          }
        }),
      `bot-core: skills of bot "${botId}"`,
    )

    ctx.effect(
      () =>
        ctx.tools.register(
          defineTool({
            name: SKILL_MANAGE_TOOL,
            description: SKILL_MANAGE_DESCRIPTION,
            parameters: {
              action: {
                type: "string",
                enum: [...SKILL_ACTIONS],
                required: true,
                description: SKILL_MANAGE_PARAMETERS.action,
              },
              name: { type: "string", description: SKILL_MANAGE_PARAMETERS.name },
              file_path: { type: "string", description: SKILL_MANAGE_PARAMETERS.file_path },
              version: { type: "string", description: SKILL_MANAGE_PARAMETERS.version },
              content: { type: "string", description: SKILL_MANAGE_PARAMETERS.content },
              old_text: { type: "string", description: SKILL_MANAGE_PARAMETERS.old_text },
              new_text: { type: "string", description: SKILL_MANAGE_PARAMETERS.new_text },
              reason: { type: "string", description: SKILL_MANAGE_PARAMETERS.reason },
              absorbed_into: { type: "string", description: SKILL_MANAGE_PARAMETERS.absorbed_into },
            },
            output: OUTPUT,
            async execute(args, exec) {
              if (exec.agent === undefined) {
                throw new ToolContextUnavailableError("skill_manage requires the calling Agent")
              }
              return call(botId, token, { agentId: exec.agent.id, args }, exec.signal)
            },
          }),
          { when: ({ agent }) => available(botId, token, agent.id) },
        ),
      `bot-core: skill_manage of bot "${botId}"`,
    )

    ctx.on("agent/pre-step", async (payload, next): Promise<PreStepDecision> => {
      await prepare(botId, token, payload.agent.id, payload.signal)
      payload.signal.throwIfAborted()
      return next()
    })
  }
}
