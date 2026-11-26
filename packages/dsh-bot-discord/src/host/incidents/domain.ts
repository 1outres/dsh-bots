import { z } from "zod"

const snowflake = z.string().regex(/^[0-9]{17,20}$/)

/**
 * A credential incident's card at the bot's home, keyed by
 * {@link incidentNoticeKey}: it was shown there once. Version 2 kept one per
 * owner's DM (with a `userId`); those are adopted or forgotten per home.
 */
export const incidentNoticeSchema = z.object({
  botId: z.string().min(1),
  incidentId: z.string().min(1),
  channelId: snowflake,
  messageId: snowflake,
})

export type IncidentNoticeRecord = z.infer<typeof incidentNoticeSchema>

export const incidentNoticeKey = (botId: string, incidentId: string) => `${botId}:${incidentId}`
