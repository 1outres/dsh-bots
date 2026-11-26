import { z } from "zod"
import {
  BOT_PEER_LIMITS,
  BOT_PEER_MESSAGE_STATES,
  BOT_PEER_REFUSALS,
  BOT_PEER_WITHDRAWALS,
} from "../../shared/peers"

const time = z.number().int().nonnegative()

const pauseSchema = z.discriminatedUnion("reason", [
  z.strictObject({ reason: z.literal("owner"), at: time }),
  z.strictObject({ reason: z.literal("limit"), at: time, detail: z.enum(BOT_PEER_LIMITS) }),
])

export const peerGroupRecordSchema = z.object({
  name: z.string().min(1),
  purpose: z.string(),
  paused: pauseSchema.optional(),
  createdAt: time,
})

export type PeerGroupRecord = z.infer<typeof peerGroupRecordSchema>

export const peerMemberRecordSchema = z.object({
  groupId: z.string().min(1),
  role: z.string(),
  joinedAt: time,
})

export type PeerMemberRecord = z.infer<typeof peerMemberRecordSchema>

export const peerMessageRecordSchema = z.object({
  groupId: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  threadId: z.string().min(1),
  replyTo: z.string().min(1).optional(),
  expectsReply: z.boolean(),
  depth: z.number().int().nonnegative(),
  text: z.string(),
  sentAt: time,
  state: z.enum(BOT_PEER_MESSAGE_STATES),
  refusal: z.enum(BOT_PEER_REFUSALS).optional(),
  withdrawal: z.enum(BOT_PEER_WITHDRAWALS).optional(),
  noticeId: z.string().min(1).optional(),
})

export type PeerMessageRecord = z.infer<typeof peerMessageRecordSchema>

export const PEERS_DOMAIN = {
  name: "dsh_bot_peers",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    groups: { valueSchema: peerGroupRecordSchema },
    members: { valueSchema: peerMemberRecordSchema },
    messages: { valueSchema: peerMessageRecordSchema },
  },
} as const
