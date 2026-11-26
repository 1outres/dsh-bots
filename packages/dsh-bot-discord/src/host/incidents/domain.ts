import { z } from "zod"

const snowflake = z.string().regex(/^[0-9]{17,20}$/)

export const incidentNoticeSchema = z.object({
  botId: z.string().min(1),
  incidentId: z.string().min(1),
  channelId: snowflake,
  messageId: snowflake,
})

export type IncidentNoticeRecord = z.infer<typeof incidentNoticeSchema>

export const incidentNoticeKey = (botId: string, incidentId: string) => `${botId}:${incidentId}`
