import { z } from "zod"

export const NOTICE_TOPICS = [
  "connector",
  "schedule",
  "event",
  "file",
  "session",
  "heartbeat",
  "peer",
  "peer-status",
  "peer-session",
] as const

export type NoticeTopic = (typeof NOTICE_TOPICS)[number]

export const PEER_ORIGIN_TOPICS: readonly NoticeTopic[] = ["peer", "peer-session"]

export const noticeRecordSchema = z.object({
  botId: z.string().min(1),
  topic: z.enum(NOTICE_TOPICS),
  messageId: z.string().min(1),
  text: z.string().min(1),
  summary: z.string().min(1),
  peerMessages: z.array(z.string().min(1)).optional(),
  createdAt: z.number().int().nonnegative(),
})

export type NoticeRecord = z.infer<typeof noticeRecordSchema>

export const NOTICES_DOMAIN = {
  name: "dsh_bot_notices",
  version: 7,
  compatibleVersions: [1, 2, 3, 4, 5, 6],
  invalidRecords: "backup-and-skip",
  tables: {
    notices: { valueSchema: noticeRecordSchema },
  },
} as const
