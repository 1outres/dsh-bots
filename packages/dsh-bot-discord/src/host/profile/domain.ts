import { z } from "zod"

const snowflake = z.string().regex(/^[0-9]{17,20}$/)

export const profileRecordSchema = z.object({
  botId: z.string().min(1),
  userId: snowflake,
  username: z.string().min(1).optional(),
  avatar: z.string().min(1).optional(),
})

export type ProfileRecord = z.infer<typeof profileRecordSchema>
