import { z } from "zod"

/** The kinds of notice bot-core sends a bot's Main session, each its own message source. */
export const NOTICE_TOPICS = ["connector", "schedule", "event", "file", "session"] as const

export type NoticeTopic = (typeof NOTICE_TOPICS)[number]

/**
 * One notice not yet recorded in the bot's Main session, keyed by its id.
 * `messageId` is the id of the one message that carries it, whichever
 * delivery attempt records it.
 */
export const noticeRecordSchema = z.object({
  botId: z.string().min(1),
  topic: z.enum(NOTICE_TOPICS),
  messageId: z.string().min(1),
  text: z.string().min(1),
  summary: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
})

export type NoticeRecord = z.infer<typeof noticeRecordSchema>

/**
 * bot-core's outbox of notices to bots' Main sessions (design rule 27).
 * Version 2 added the `schedule` topic, version 3 the `event` topic
 * (connectors' events), version 4 the `file` topic (presented files that
 * did not reach a channel), version 5 the `session` topic (managed
 * sessions); every earlier notice is a valid version 5 one, hence
 * `compatibleVersions`.
 */
export const NOTICES_DOMAIN = {
  name: "dsh_bot_notices",
  version: 5,
  compatibleVersions: [1, 2, 3, 4],
  invalidRecords: "backup-and-skip",
  tables: {
    notices: { valueSchema: noticeRecordSchema },
  },
} as const
