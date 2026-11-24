/**
 * `@1outres/dsh-bot-core/schedule`: bot-core's own row inside every bot's
 * isolated `bot-environment` group (compose.ts puts it after the connectors
 * row; templates and overlays cannot name it). It registers `schedule` and
 * `schedule_result`, each shown only to the Agents the `bot` service lets
 * use it (the bot's Main session; a scheduled separate run's own session),
 * and passes every call to the service with the revision's token.
 */
import type { Context } from "@deepseek-ai/cordis"
import { defineTool, ToolContextUnavailableError } from "@deepseek-ai/dsh-tools"
import z from "@deepseek-ai/schemastery"
import { BOT_SERVICE, type Bot, botOf } from "../contract"
import {
  CALL_SCHEDULE_TOOL,
  type CallScheduleTool,
  SCHEDULE_TOOL_AVAILABLE,
  type ScheduleToolAvailable,
  type ScheduleToolName,
} from "../internal"

export interface Config {
  botId: string
  /** The preset revision's token (compose.ts); bot-core refuses calls of other revisions. */
  token: string
}

/** The rule for choosing a job's mode (docs/specs/bot-schedule.md). */
export const MODE_RULE =
  "Use main when the work should continue this conversation, with its context and leaving its steps in it. " +
  "Use separate when it should run apart from the conversation and only its outcome should come back to you; its instruction must then stand on its own. " +
  "For a wait within the current turn, use a background command instead of a schedule."

export const SCHEDULE_DESCRIPTION =
  "Manage your own scheduled jobs: work you do later or repeatedly, without the user asking at that moment. " +
  "Actions: create (name, mode, schedule, instruction, optional check and timezone), list, update (id and the fields to change, enabled included), delete (id), run (id: run now; the outcome comes later). " +
  "create and update answer with the next 3 runs in the job's local time. " +
  "When a job runs, what it found reaches your Main session as a [schedule] notice and you write whatever the user gets; nothing reaches the user on its own. " +
  `Modes: ${MODE_RULE} ` +
  "schedule: at (ISO 8601 date-time; without an offset it is the job's time zone), after (a span such as 30m or 2h), every (a span, at least 5m) or cron (5 fields in the job's time zone, runs at least 5 minutes apart). " +
  "check: a bash command run in your environment before each run: exit 0 runs the job with its output, exit 1 skips it quietly, anything else counts as a failure. " +
  "A bot has at most 20 jobs. In a scheduled run's own session only update and delete of that run's job are available, without an id."

export const SCHEDULE_RESULT_DESCRIPTION =
  "Finish this scheduled separate run: call it once, with outcome report and the report your Main session should turn into a message for the user, or outcome nothing when there is nothing worth telling. " +
  "Without it the run counts as failed."

const toolFor = <T>(bot: Bot, key: symbol): T => {
  const method: unknown = Reflect.get(bot, key)
  if (typeof method !== "function") {
    throw new Error(`the "${BOT_SERVICE}" service cannot serve a bot's schedule tools`)
  }
  return (method as (...args: never[]) => unknown).bind(bot) as T
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

export default class BotScheduleTools {
  static inject = [BOT_SERVICE, "tools"]
  static Config: z<Config> = z.object({
    botId: z.string().required().description("The bot whose preset holds this row."),
    token: z.string().required().description("Token of the preset revision holding this row."),
  }) as z<Config>

  constructor(ctx: Context, config: Config) {
    const bot = botOf(ctx)
    const available = toolFor<ScheduleToolAvailable>(bot, SCHEDULE_TOOL_AVAILABLE)
    const call = toolFor<CallScheduleTool>(bot, CALL_SCHEDULE_TOOL)
    const when =
      (tool: ScheduleToolName) =>
      ({ agent }: { readonly agent: { readonly id: string } }) =>
        available(config.botId, config.token, agent.id, tool)
    const run = async (tool: ScheduleToolName, args: unknown, exec: { agent?: { id: string } }) => {
      if (exec.agent === undefined) {
        throw new ToolContextUnavailableError(`${tool} requires the calling Agent`)
      }
      const response = await call(config.botId, config.token, {
        agentId: exec.agent.id,
        tool,
        args,
      })
      return { text: response.text, data: response.data as never }
    }
    ctx.effect(
      () =>
        ctx.tools.register(
          defineTool({
            name: "schedule",
            description: SCHEDULE_DESCRIPTION,
            parameters: {
              action: {
                type: "string",
                enum: ["create", "list", "update", "delete", "run"],
                required: true,
              },
              id: { type: "string", description: "The job (update, delete, run)." },
              name: { type: "string", description: "A short name of the job." },
              mode: { type: "string", enum: ["main", "separate"], description: MODE_RULE },
              schedule: {
                type: "object",
                additionalProperties: false,
                description:
                  'When it runs: { "kind": "at", "at": "2026-05-01T09:00" }, { "kind": "after", "delay": "30m" }, { "kind": "every", "interval": "1h" } or { "kind": "cron", "expr": "0 9 * * 1-5" }.',
                properties: {
                  kind: { type: "string", enum: ["at", "after", "every", "cron"], required: true },
                  at: { type: "string" },
                  delay: { type: "string" },
                  interval: { type: "string" },
                  expr: { type: "string" },
                },
              },
              instruction: {
                type: "string",
                description:
                  "What to do when it runs; for separate it must stand on its own, without this conversation.",
              },
              check: {
                description:
                  "A command deciding whether a run goes ahead; null removes it (update).",
                oneOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      command: { type: "string", required: true },
                      timeout_seconds: {
                        type: "integer",
                        description: "Default 60, at most 300.",
                      },
                    },
                  },
                  { type: "null" },
                ],
              },
              timezone: {
                type: "string",
                description: "IANA time zone of the job; defaults to the bot's time zone setting.",
              },
              enabled: { type: "boolean", description: "Pause (false) or resume (true) the job." },
            },
            output: OUTPUT,
            execute: (args, exec) => run("schedule", args, exec),
          }),
          { when: when("schedule") },
        ),
      `bot-core: schedule of bot "${config.botId}"`,
    )
    ctx.effect(
      () =>
        ctx.tools.register(
          defineTool({
            name: "schedule_result",
            description: SCHEDULE_RESULT_DESCRIPTION,
            parameters: {
              outcome: { type: "string", enum: ["report", "nothing"], required: true },
              report: {
                type: "string",
                description: "With outcome report: what the user should learn from this run.",
              },
            },
            output: OUTPUT,
            execute: (args, exec) => run("schedule_result", args, exec),
          }),
          { when: when("schedule_result") },
        ),
      `bot-core: schedule_result of bot "${config.botId}"`,
    )
  }
}
