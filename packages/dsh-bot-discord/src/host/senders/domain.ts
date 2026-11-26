import { z } from "zod"

const snowflake = z.string().regex(/^[0-9]{17,20}$/)

export const inquiryCardSchema = z.object({
  botId: z.string().min(1),
  inquiryId: z.string().min(1),
  channelId: snowflake,
  messageId: snowflake,
})

export type InquiryCardRecord = z.infer<typeof inquiryCardSchema>

export const inquiryCardKey = (botId: string, inquiryId: string) => `${botId}:${inquiryId}`
