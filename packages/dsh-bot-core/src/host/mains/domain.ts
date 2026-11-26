import { z } from "zod"

const enabled = z.boolean()
const minutes = z.number().int().positive()

const memoryFlushSchema = z.object({ enabled })

const settingsSchema = z.object({
  quietMinutes: minutes,
  idleCompaction: z.object({ enabled, minUsagePercent: z.number().int().positive() }),
  daily: z.object({ enabled, time: z.string() }),
  longIdle: z.object({ enabled, minutes }),
  compactions: z.object({ enabled, count: z.number().int().positive() }),
  memoryFlush: memoryFlushSchema.optional(),
})

const overrideSchema = z.object({
  quietMinutes: minutes.optional(),
  idleCompaction: settingsSchema.shape.idleCompaction.partial().optional(),
  daily: settingsSchema.shape.daily.partial().optional(),
  longIdle: settingsSchema.shape.longIdle.partial().optional(),
  compactions: settingsSchema.shape.compactions.partial().optional(),
  memoryFlush: memoryFlushSchema.partial().optional(),
})

export const mainActivitySchema = z.object({
  sessionId: z.string().min(1),
  firstTurnAt: z.number().int().nonnegative().optional(),
  lastTurnAt: z.number().int().nonnegative().optional(),
  compactions: z.number().int().nonnegative(),
  idleCompactedFor: z.number().int().nonnegative().optional(),
})

export type MainActivityRecord = z.infer<typeof mainActivitySchema>
export type StoredMainSettings = z.infer<typeof settingsSchema>
export type StoredMainOverride = z.infer<typeof overrideSchema>

export const MAIN_DEFAULTS_KEY = "defaults"

export const MAINS_DOMAIN = {
  name: "dsh_bot_mains",
  version: 2,
  compatibleVersions: [1],
  invalidRecords: "backup-and-skip",
  tables: {
    settings: { valueSchema: settingsSchema },
    overrides: { valueSchema: overrideSchema },
    activity: { valueSchema: mainActivitySchema },
  },
} as const
