import { z } from "zod"

export const NOTICE_TOPICS = ["connector", "schedule", "event", "file", "session"] as const

export type NoticeTopic = (typeof NOTICE_TOPICS)[number]

export const noticeRecordSchema = z.object({
  botId: z.string().min(1),
  topic: z.enum(NOTICE_TOPICS),
  messageId: z.string().min(1),
  text: z.string().min(1),
  summary: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
})

export type NoticeRecord = z.infer<typeof noticeRecordSchema>

export const NOTICES_DOMAIN = {
  name: "dsh_bot_notices",
  version: 5,
  compatibleVersions: [1, 2, 3, 4],
  invalidRecords: "backup-and-skip",
  tables: {
    notices: { valueSchema: noticeRecordSchema },
  },
} as const
