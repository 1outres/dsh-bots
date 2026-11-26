import { z } from "zod"

export const SCHEDULE_MODES = ["main", "separate"] as const
export type ScheduleMode = (typeof SCHEDULE_MODES)[number]

export const RUN_TRIGGERS = ["schedule", "manual"] as const
export type RunTrigger = (typeof RUN_TRIGGERS)[number]

export const RUN_STATES = [
  "running",
  "skipped",
  "quiet",
  "ran",
  "reported",
  "nothing",
  "failed",
] as const
export type RunState = (typeof RUN_STATES)[number]

export const FAILURE_STAGES = ["check", "run"] as const
export type FailureStage = (typeof FAILURE_STAGES)[number]

export const storedScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: z.number().int() }),
  z.object({ kind: z.literal("every"), everySeconds: z.number().int().positive() }),
  z.object({ kind: z.literal("cron"), expression: z.string().min(1) }),
])
export type StoredSchedule = z.infer<typeof storedScheduleSchema>

export const scheduleCheckSchema = z.object({
  command: z.string().min(1),
  timeoutSeconds: z.number().int().positive(),
})
export type ScheduleCheck = z.infer<typeof scheduleCheckSchema>

export const jobRecordSchema = z.object({
  botId: z.string().min(1),
  name: z.string().min(1),
  mode: z.enum(SCHEDULE_MODES),
  schedule: storedScheduleSchema,
  timezone: z.string().min(1),
  instruction: z.string().min(1),
  check: scheduleCheckSchema.optional(),
  enabled: z.boolean(),
  createdBy: z.object({ sessionId: z.string().min(1) }),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  nextRunAt: z.number().int().optional(),
  failureStreak: z.number().int().nonnegative(),
})
export type JobRecord = z.infer<typeof jobRecordSchema>

export const runFailureSchema = z.object({
  stage: z.enum(FAILURE_STAGES),
  message: z.string().min(1),
  exitCode: z.number().int().optional(),
  stderr: z.string().optional(),
})
export type RunFailure = z.infer<typeof runFailureSchema>

export const runRecordSchema = z.object({
  botId: z.string().min(1),
  jobId: z.string().min(1),
  trigger: z.enum(RUN_TRIGGERS),
  scheduledAt: z.number().int(),
  startedAt: z.number().int().nonnegative(),
  state: z.enum(RUN_STATES),
  endedAt: z.number().int().nonnegative().optional(),
  sessionId: z.string().min(1).optional(),
  failure: runFailureSchema.optional(),
})
export type RunRecord = z.infer<typeof runRecordSchema>

export interface ScheduleJob extends JobRecord {
  readonly id: string
}

export interface ScheduleRun extends RunRecord {
  readonly id: string
}

export const SCHEDULES_DOMAIN = {
  name: "dsh_bot_schedules",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    jobs: { valueSchema: jobRecordSchema },
    runs: { valueSchema: runRecordSchema },
  },
} as const
