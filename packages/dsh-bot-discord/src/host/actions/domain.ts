import { z } from "zod"

const snowflake = z.string().regex(/^[0-9]{17,20}$/)

/** A connector action's card in one approver's DM, keyed by {@link cardKey}. */
export const cardRecordSchema = z.object({
  botId: z.string().min(1),
  actionId: z.string().min(1),
  userId: snowflake,
  channelId: snowflake,
  messageId: snowflake,
})

export type CardRecord = z.infer<typeof cardRecordSchema>

/**
 * Whether the pending approvals list was pinned: `due` until the one try
 * after it was posted, then `pinned` or `abandoned` (Discord refused it).
 */
export const DIGEST_PIN_STATES = ["due", "pinned", "abandoned"] as const

export type DigestPinState = (typeof DIGEST_PIN_STATES)[number]

/** The pending approvals list in one approver's DM, keyed by {@link digestKey}. */
export const digestRecordSchema = z.object({
  botId: z.string().min(1),
  userId: snowflake,
  channelId: snowflake,
  messageId: snowflake,
  pin: z.enum(DIGEST_PIN_STATES),
})

export type DigestRecord = z.infer<typeof digestRecordSchema>

export const cardKey = (botId: string, actionId: string, userId: string) =>
  `${botId}:${actionId}:${userId}`

export const digestKey = (botId: string, userId: string) => `${botId}:${userId}`

/**
 * Where the connector approval messages of every bot sit in its approvers'
 * DMs, so a new connection edits them instead of posting them again.
 * Disposable: a record that no longer parses is set aside and its message
 * posted anew.
 */
export const DISCORD_DOMAIN = {
  name: "dsh_bot_discord",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    cards: { valueSchema: cardRecordSchema },
    digests: { valueSchema: digestRecordSchema },
  },
} as const
