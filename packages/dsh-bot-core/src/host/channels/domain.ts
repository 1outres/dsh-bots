import { z } from "zod"

/**
 * A bot's settings for one channel, keyed by {@link channelRecordKey}. Secret
 * values live in DSH's credential store (host/channels/vault.ts); the record
 * names the secret fields that hold one.
 */
export const channelRecordSchema = z.object({
  botId: z.string().min(1),
  channelId: z.string().min(1),
  enabled: z.boolean(),
  values: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
  secrets: z.array(z.string()),
  updatedAt: z.number().int().nonnegative(),
})

export type ChannelRecord = z.infer<typeof channelRecordSchema>

export function channelRecordKey(botId: string, channelId: string): string {
  return `${botId}:${channelId}`
}

/** Bots' channel settings, apart from the bot records (design rule 27 covers both domains). */
export const CHANNELS_DOMAIN = {
  name: "dsh_bot_channels",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    channels: { valueSchema: channelRecordSchema },
  },
} as const
