import { z } from "zod"
import {
  type JobRecord,
  SCHEDULE_MODES,
  type ScheduleCheck,
  type ScheduleJob,
  type ScheduleRun,
} from "./domain"
import {
  canonicalTimezone,
  describeSchedule,
  firstRun,
  formatLocal,
  InvalidScheduleError,
  planSchedule,
  type Timing,
  upcomingRuns,
} from "./timing"

export const MAX_JOBS_PER_BOT = 20
export const MAX_NAME_LENGTH = 120
export const MAX_INSTRUCTION_LENGTH = 8000
export const MAX_COMMAND_LENGTH = 4000
export const DEFAULT_CHECK_TIMEOUT_SECONDS = 60
export const MAX_CHECK_TIMEOUT_SECONDS = 300
export const UPCOMING_COUNT = 3

const scheduleInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("at"), at: z.string().min(1) }),
  z.strictObject({ kind: z.literal("after"), delay: z.string().min(1) }),
  z.strictObject({ kind: z.literal("every"), interval: z.string().min(1) }),
  z.strictObject({ kind: z.literal("cron"), expr: z.string().min(1) }),
])

const checkInputSchema = z.strictObject({
  command: z.string().trim().min(1).max(MAX_COMMAND_LENGTH),
  timeout_seconds: z.number().int().min(1).max(MAX_CHECK_TIMEOUT_SECONDS).optional(),
})

const fields = {
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  mode: z.enum(SCHEDULE_MODES),
  schedule: scheduleInputSchema,
  instruction: z.string().trim().min(1).max(MAX_INSTRUCTION_LENGTH),
  timezone: z.string().min(1),
}

export const createInputSchema = z.strictObject({
  ...fields,
  timezone: fields.timezone.optional(),
  check: checkInputSchema.optional(),
})
export type CreateInput = z.infer<typeof createInputSchema>

export const updateInputSchema = z.strictObject({
  name: fields.name.optional(),
  mode: fields.mode.optional(),
  schedule: fields.schedule.optional(),
  instruction: fields.instruction.optional(),
  timezone: fields.timezone.optional(),
  check: checkInputSchema.nullable().optional(),
  enabled: z.boolean().optional(),
})
export type UpdateInput = z.infer<typeof updateInputSchema>

export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  const at = issue?.path.length ? `${issue.path.join(".")}: ` : ""
  throw new InvalidScheduleError(`${at}${issue?.message ?? "malformed"}`)
}

const checkOf = (input: z.infer<typeof checkInputSchema>): ScheduleCheck => ({
  command: input.command,
  timeoutSeconds: input.timeout_seconds ?? DEFAULT_CHECK_TIMEOUT_SECONDS,
})

const timingOf = (job: Pick<JobRecord, "schedule" | "timezone">): Timing => ({
  schedule: job.schedule,
  timezone: job.timezone,
})

const requireFirstRun = (timing: Timing, now: number): number => {
  const first = firstRun(timing, now)
  if (first === undefined) throw new InvalidScheduleError("this schedule never runs")
  return first
}

export function newJob(
  input: CreateInput,
  context: {
    readonly botId: string
    readonly sessionId: string
    readonly botTimezone: string
    readonly now: number
  },
): JobRecord {
  const timezone = canonicalTimezone(input.timezone ?? context.botTimezone)
  const schedule = planSchedule(input.schedule, timezone, context.now)
  return {
    botId: context.botId,
    name: input.name,
    mode: input.mode,
    schedule,
    timezone,
    instruction: input.instruction,
    ...(input.check === undefined ? {} : { check: checkOf(input.check) }),
    enabled: true,
    createdBy: { sessionId: context.sessionId },
    createdAt: context.now,
    updatedAt: context.now,
    nextRunAt: requireFirstRun({ schedule, timezone }, context.now),
    failureStreak: 0,
  }
}

export function changedJob(job: JobRecord, change: UpdateInput, now: number): JobRecord {
  const timezone = change.timezone === undefined ? job.timezone : canonicalTimezone(change.timezone)
  const schedule =
    change.schedule === undefined ? job.schedule : planSchedule(change.schedule, timezone, now)
  const retimed =
    change.schedule !== undefined || (timezone !== job.timezone && schedule.kind === "cron")
  const enabled = change.enabled ?? job.enabled
  const resumed = enabled && !job.enabled && schedule.kind !== "at"
  const { check: _check, nextRunAt: _next, ...rest } = job
  const check =
    change.check === undefined
      ? job.check
      : change.check === null
        ? undefined
        : checkOf(change.check)
  const nextRunAt =
    retimed || resumed ? requireFirstRun({ schedule, timezone }, now) : job.nextRunAt
  return {
    ...rest,
    ...(change.name === undefined ? {} : { name: change.name }),
    ...(change.mode === undefined ? {} : { mode: change.mode }),
    ...(change.instruction === undefined ? {} : { instruction: change.instruction }),
    schedule,
    timezone,
    enabled,
    ...(check === undefined ? {} : { check }),
    ...(nextRunAt === undefined ? {} : { nextRunAt }),
    updatedAt: now,
  }
}

export const isArmed = (job: JobRecord): job is JobRecord & { nextRunAt: number } =>
  job.enabled && job.nextRunAt !== undefined

export const recursArmed = (job: JobRecord): boolean => isArmed(job) && job.schedule.kind !== "at"

export interface JobView {
  readonly id: string
  readonly name: string
  readonly mode: string
  readonly schedule: string
  readonly timezone: string
  readonly instruction: string
  readonly check?: { readonly command: string; readonly timeout_seconds: number }
  readonly enabled: boolean
  readonly next_runs: readonly string[]
  readonly last_run?: {
    readonly state: string
    readonly at: string
    readonly failure?: string
  }
  readonly failure_streak: number
}

export function jobView(
  job: ScheduleJob,
  lastRun: ScheduleRun | undefined,
  upcoming: number,
): JobView {
  const timing = timingOf(job)
  const local = (ms: number) => formatLocal(ms, job.timezone)
  return {
    id: job.id,
    name: job.name,
    mode: job.mode,
    schedule: describeSchedule(timing),
    timezone: job.timezone,
    instruction: job.instruction,
    ...(job.check === undefined
      ? {}
      : { check: { command: job.check.command, timeout_seconds: job.check.timeoutSeconds } }),
    enabled: job.enabled,
    next_runs: job.enabled ? upcomingRuns(timing, job.nextRunAt, upcoming).map(local) : [],
    ...(lastRun === undefined
      ? {}
      : {
          last_run: {
            state: lastRun.state,
            at: local(lastRun.startedAt),
            ...(lastRun.failure === undefined ? {} : { failure: lastRun.failure.message }),
          },
        }),
    failure_streak: job.failureStreak,
  }
}

export function describeJob(view: JobView): string {
  const lines = [
    `"${view.name}" (${view.id}) — ${view.mode}, ${view.schedule}${view.enabled ? "" : ", disabled"}`,
    `  next: ${view.next_runs.length > 0 ? view.next_runs.join(", ") : "none"}`,
  ]
  if (view.check !== undefined) {
    lines.push(`  check (${view.check.timeout_seconds}s): ${view.check.command}`)
  }
  if (view.last_run !== undefined) {
    lines.push(
      `  last run: ${view.last_run.state} at ${view.last_run.at}${view.last_run.failure === undefined ? "" : ` — ${view.last_run.failure}`}`,
    )
  }
  if (view.failure_streak > 0) lines.push(`  failing: ${view.failure_streak} run(s) in a row`)
  return lines.join("\n")
}
