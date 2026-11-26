import { z } from "zod"

const channelTextSchema = z.object({ en: z.string().min(1), ja: z.string().optional() })

const channelValuesSchema = z.record(z.string(), z.union([z.string(), z.array(z.string())]))

export const channelInitialFailureSchema = z.object({
  state: z.literal("failed"),
  reason: channelTextSchema,
  at: z.number().int().nonnegative(),
})

export const channelRecordSchema = z.object({
  botId: z.string().min(1),
  channelId: z.string().min(1),
  enabled: z.boolean(),
  values: channelValuesSchema,
  secrets: z.array(z.string()),
  settingsVersion: z.number().int().positive().optional(),
  profileSync: z.boolean().optional(),
  initial: channelInitialFailureSchema.optional(),
  updatedAt: z.number().int().nonnegative(),
})

export type ChannelRecord = z.infer<typeof channelRecordSchema>

export const sharedChannelRecordSchema = z.object({
  channelId: z.string().min(1),
  values: channelValuesSchema,
  secrets: z.array(z.string()),
  newBots: z.boolean(),
  settingsVersion: z.number().int().positive().optional(),
  updatedAt: z.number().int().nonnegative(),
})

export type SharedChannelRecord = z.infer<typeof sharedChannelRecordSchema>

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
    shared: { valueSchema: sharedChannelRecordSchema },
  },
} as const
