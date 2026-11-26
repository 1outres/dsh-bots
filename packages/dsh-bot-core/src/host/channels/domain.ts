import { z } from "zod"

export const channelRecordSchema = z.object({
  botId: z.string().min(1),
  channelId: z.string().min(1),
  enabled: z.boolean(),
  values: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  secrets: z.array(z.string()),
  settingsVersion: z.number().int().positive().optional(),
  profileSync: z.boolean().optional(),
  updatedAt: z.number().int().nonnegative(),
})

export type ChannelRecord = z.infer<typeof channelRecordSchema>

export function channelRecordKey(botId: string, channelId: string): string {
  return `${botId}:${channelId}`
}

export const CHANNELS_DOMAIN = {
  name: "dsh_bot_channels",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    channels: { valueSchema: channelRecordSchema },
  },
} as const
