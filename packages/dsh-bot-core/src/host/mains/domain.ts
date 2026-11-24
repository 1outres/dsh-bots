import { z } from "zod"

const enabled = z.boolean()
const minutes = z.number().int().positive()

const memoryFlushSchema = z.object({ enabled })

/**
 * The dsh-bots defaults, as stored. `memoryFlush` came with version 2: a
 * version 1 row has none until the store completes it on opening.
 */
const settingsSchema = z.object({
  quietMinutes: minutes,
  idleCompaction: z.object({ enabled, minUsagePercent: z.number().int().positive() }),
  daily: z.object({ enabled, time: z.string() }),
  longIdle: z.object({ enabled, minutes }),
  compactions: z.object({ enabled, count: z.number().int().positive() }),
  memoryFlush: memoryFlushSchema.optional(),
})

/** One bot's override, as stored: the validated shape of `MainRotationOverride`. */
const overrideSchema = z.object({
  quietMinutes: minutes.optional(),
  idleCompaction: settingsSchema.shape.idleCompaction.partial().optional(),
  daily: settingsSchema.shape.daily.partial().optional(),
  longIdle: settingsSchema.shape.longIdle.partial().optional(),
  compactions: settingsSchema.shape.compactions.partial().optional(),
  memoryFlush: memoryFlushSchema.partial().optional(),
})

/**
 * What bot-core knows of a bot's current Main between turns, keyed by bot id.
 * It describes `sessionId` only: a record of an earlier Main reads as none.
 */
export const mainActivitySchema = z.object({
  sessionId: z.string().min(1),
  /** End of the Main's first ordinary turn: its daily boundary is the first one after it. */
  firstTurnAt: z.number().int().nonnegative().optional(),
  /** End of the Main's last ordinary turn (maintenance turns are not counted). */
  lastTurnAt: z.number().int().nonnegative().optional(),
  /** Successful compactions in the Main's log, as last counted. */
  compactions: z.number().int().nonnegative(),
  /** The `lastTurnAt` after which an idle compaction was last tried. */
  idleCompactedFor: z.number().int().nonnegative().optional(),
})

export type MainActivityRecord = z.infer<typeof mainActivitySchema>
export type StoredMainSettings = z.infer<typeof settingsSchema>
export type StoredMainOverride = z.infer<typeof overrideSchema>

/** Key of the one row of the `settings` table. */
export const MAIN_DEFAULTS_KEY = "defaults"

/**
 * The dsh-bots defaults, each bot's override and each bot's Main activity
 * (docs/specs/bot-main-rotation.md). Version 2 added `memoryFlush`; every
 * version 1 unit is a valid version 2 unit, hence `compatibleVersions`.
 */
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
