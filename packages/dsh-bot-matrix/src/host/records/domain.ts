import { z } from "zod"

const id = z.string().min(1)

export const ACCOUNT_STATES = ["active", "retiring", "retired"] as const

export const accountRecordSchema = z.object({
  botId: id,
  userId: id,
  serverName: id,
  state: z.enum(ACCOUNT_STATES),
  retirement: z.enum(["deactivated", "vacated"]).optional(),
  profile: z.object({ name: z.string().optional(), avatar: z.string().optional() }).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

export type AccountRecord = z.infer<typeof accountRecordSchema>

export const homeRecordSchema = z.object({
  botId: id,
  owner: id,
  roomId: id,
  updatedAt: z.number().int().nonnegative(),
})

export type HomeRecord = z.infer<typeof homeRecordSchema>

export const cursorRecordSchema = z.object({
  botId: id,
  since: id,
  roomId: id,
  lastEventId: id.optional(),
  updatedAt: z.number().int().nonnegative(),
})

export type CursorRecord = z.infer<typeof cursorRecordSchema>

export const cardRecordSchema = z.object({
  botId: id,
  actionId: id,
  roomId: id,
  eventId: id,
  seeds: z.array(id),
})

export type CardRecord = z.infer<typeof cardRecordSchema>

export const digestRecordSchema = z.object({
  botId: id,
  roomId: id,
  eventId: id,
  pinned: z.boolean(),
})

export type DigestRecord = z.infer<typeof digestRecordSchema>

export const incidentRecordSchema = z.object({
  botId: id,
  incidentId: id,
  roomId: id,
  eventId: id,
})

export type IncidentRecord = z.infer<typeof incidentRecordSchema>

export const MATRIX_DOMAIN = {
  name: "dsh_bot_matrix",
  version: 1,
  compatibleVersions: [],
  invalidRecords: "backup-and-skip",
  tables: {
    accounts: { valueSchema: accountRecordSchema },
    homes: { valueSchema: homeRecordSchema },
    cursors: { valueSchema: cursorRecordSchema },
    cards: { valueSchema: cardRecordSchema },
    digests: { valueSchema: digestRecordSchema },
    incidents: { valueSchema: incidentRecordSchema },
  },
} as const

export interface RecordTable<V> {
  get(key: string): V | undefined
  entries(): Iterable<[string, V]>
  put(key: string, value: V): Promise<void>
  delete(key: string): Promise<unknown>
}

export interface MatrixTables {
  readonly accounts: RecordTable<AccountRecord>
  readonly homes: RecordTable<HomeRecord>
  readonly cursors: RecordTable<CursorRecord>
  readonly cards: RecordTable<CardRecord>
  readonly digests: RecordTable<DigestRecord>
  readonly incidents: RecordTable<IncidentRecord>
}

export const cardKey = (botId: string, actionId: string) => `${botId}:${actionId}`
export const incidentKey = (botId: string, incidentId: string) => `${botId}:${incidentId}`
