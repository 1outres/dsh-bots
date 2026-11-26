import { z } from "zod"
import type { ConnectorJson } from "../../shared/connectors"
import {
  SENDER_CHOICES,
  SENDER_MATCH_KINDS,
  SENDER_UNKNOWNS,
  SENDER_VERDICTS,
} from "../../shared/senders"

const time = z.number().int().nonnegative()

const originSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("web") }),
  z.strictObject({
    kind: z.literal("channel"),
    channelId: z.string().min(1),
    channelName: z.string().min(1),
    person: z.string().min(1),
  }),
])

const matchSchema = z.strictObject({
  kind: z.enum(SENDER_MATCH_KINDS),
  value: z.string().min(1),
})

const ruleSchema = z.strictObject({
  match: matchSchema,
  verdict: z.enum(SENDER_VERDICTS),
  decidedAt: time,
  origin: originSchema,
})

export const senderPolicyRecordSchema = z.object({
  connectionId: z.string().min(1),
  unknown: z.enum(SENDER_UNKNOWNS),
  rules: z.array(ruleSchema),
  updatedAt: time,
})

export type SenderPolicyRecord = z.infer<typeof senderPolicyRecordSchema>

export const connectorSenderSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("self") }),
  z.strictObject({ kind: z.literal("external"), address: z.string(), verified: z.boolean() }),
  z.strictObject({ kind: z.literal("anonymous") }),
])

const heldEventSchema = z.object({
  key: z.string().min(1),
  kind: z.string().min(1),
  occurredAt: time,
  summary: z.string(),
  ref: z.json(),
  sender: connectorSenderSchema,
})

export type HeldEvent = Omit<z.infer<typeof heldEventSchema>, "ref"> & {
  readonly ref: ConnectorJson
}

const inquiryStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }),
  z.object({
    state: z.literal("answered"),
    choice: z.enum(SENDER_CHOICES),
    origin: originSchema,
    at: time,
  }),
  z.object({ state: z.literal("covered"), verdict: z.enum(SENDER_VERDICTS), at: time }),
  z.object({ state: z.literal("expired"), at: time }),
])

export const senderInquiryRecordSchema = z.object({
  id: z.string().min(1),
  connectionId: z.string().min(1),
  connectorId: z.string().min(1),
  address: z.string().min(1),
  held: z.array(heldEventSchema),
  arrived: z.number().int().positive(),
  createdAt: time,
  updatedAt: time,
  expiresAt: time,
  status: inquiryStatusSchema,
})

export type SenderInquiryRecord = Omit<z.infer<typeof senderInquiryRecordSchema>, "held"> & {
  readonly held: readonly HeldEvent[]
}

export const SENDER_MIGRATION_KEY = "existing-connections"

export const senderMigrationRecordSchema = z.object({
  connections: z.array(z.string().min(1)),
  at: time,
})

export type SenderMigrationRecord = z.infer<typeof senderMigrationRecordSchema>

export const SENDERS_DOMAIN = {
  name: "dsh_bot_senders",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    policies: { valueSchema: senderPolicyRecordSchema },
    inquiries: { valueSchema: senderInquiryRecordSchema },
    migrations: { valueSchema: senderMigrationRecordSchema },
  },
} as const
