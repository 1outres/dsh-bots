import { z } from "zod"
import { MAX_HEARTBEAT_MINUTES, MIN_HEARTBEAT_MINUTES } from "../../shared/heartbeat"

export const heartbeatSettingsSchema = z.object({
  enabled: z.boolean(),
  intervalMinutes: z.number().int().min(MIN_HEARTBEAT_MINUTES).max(MAX_HEARTBEAT_MINUTES),
  activeHours: z.object({ start: z.string(), end: z.string() }).optional(),
})

export type HeartbeatSettingsRecord = z.infer<typeof heartbeatSettingsSchema>

export const HEARTBEATS_DOMAIN = {
  name: "dsh_bot_heartbeats",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    settings: { valueSchema: heartbeatSettingsSchema },
  },
} as const
