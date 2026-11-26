import { z } from "zod"
import { CONNECTION_STATUSES } from "../../shared/connections"

const time = z.number().int().nonnegative()

export const connectionRecordSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  services: z.array(z.string().min(1)),
  label: z.string().min(1),
  account: z.object({
    subject: z.string().min(1),
    email: z.string().optional(),
    displayName: z.string().optional(),
  }),
  grantedScopes: z.array(z.string().min(1)),
  status: z.enum(CONNECTION_STATUSES),
  statusReason: z.string().optional(),
  issuer: z.string().min(1),
  createdAt: time,
  authorizedAt: time,
})

export type ConnectionRecord = z.infer<typeof connectionRecordSchema>

export const grantRecordSchema = z.object({
  botId: z.string().min(1),
  connectionId: z.string().min(1),
  assignedAt: time,
})

export type GrantRecord = z.infer<typeof grantRecordSchema>

export function grantRecordKey(botId: string, connectionId: string): string {
  return `${botId}:${connectionId}`
}

export const clientRecordSchema = z.object({
  provider: z.string().min(1),
  clientId: z.string().min(1),
  updatedAt: time,
})

export type ClientRecord = z.infer<typeof clientRecordSchema>

export const CONNECTIONS_DOMAIN = {
  name: "dsh_bot_connections",
  version: 1,
  invalidRecords: "backup-and-skip",
  tables: {
    connections: { valueSchema: connectionRecordSchema },
    grants: { valueSchema: grantRecordSchema },
    clients: { valueSchema: clientRecordSchema },
  },
} as const
