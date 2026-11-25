import { z } from "zod"

const snowflake = z.string().regex(/^[0-9]{17,20}$/)

/** A credential incident's card in one owner's DM, keyed by {@link incidentNoticeKey}: it was shown there once. */
export const incidentNoticeSchema = z.object({
  botId: z.string().min(1),
  incidentId: z.string().min(1),
  userId: snowflake,
  channelId: snowflake,
  messageId: snowflake,
})

export type IncidentNoticeRecord = z.infer<typeof incidentNoticeSchema>

export const incidentNoticeKey = (botId: string, incidentId: string, userId: string) =>
  `${botId}:${incidentId}:${userId}`
