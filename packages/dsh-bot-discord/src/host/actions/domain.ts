import { z } from "zod"

const snowflake = z.string().regex(/^[0-9]{17,20}$/)

export const cardRecordSchema = z.object({
  botId: z.string().min(1),
  actionId: z.string().min(1),
  channelId: snowflake,
  messageId: snowflake,
})

export type CardRecord = z.infer<typeof cardRecordSchema>

export const DIGEST_PIN_STATES = ["due", "pinned", "abandoned"] as const

export type DigestPinState = (typeof DIGEST_PIN_STATES)[number]

export const digestRecordSchema = z.object({
  botId: z.string().min(1),
  channelId: snowflake,
  messageId: snowflake,
  pin: z.enum(DIGEST_PIN_STATES),
})

export type DigestRecord = z.infer<typeof digestRecordSchema>

export const cardKey = (botId: string, actionId: string) => `${botId}:${actionId}`

export const digestKey = (botId: string) => botId
