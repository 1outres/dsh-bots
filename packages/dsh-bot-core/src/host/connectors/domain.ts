import { z } from "zod"
import { CONNECTOR_EVENT_DELIVERIES } from "../../shared/connections"
import { CONNECTOR_DECISIONS, CONNECTOR_PERMISSIONS } from "../../shared/connectors"

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

export const decisionInputSchema = z.enum(CONNECTOR_DECISIONS)

const decisionSchema = z.object({
  decision: decisionInputSchema,
  origin: originSchema,
  at: time,
})

const statusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending") }),
  z.object({ state: z.literal("approved"), decision: decisionSchema }),
  z.object({ state: z.literal("executing"), decision: decisionSchema, startedAt: time }),
  z.object({
    state: z.literal("succeeded"),
    decision: decisionSchema,
    startedAt: time,
    finishedAt: time,
    result: z.json(),
    text: z.string().optional(),
  }),
  z.object({
    state: z.literal("failed"),
    decision: decisionSchema,
    startedAt: time.optional(),
    finishedAt: time,
    reason: z.string(),
  }),
  z.object({
    state: z.literal("interrupted"),
    decision: decisionSchema,
    startedAt: time,
    finishedAt: time,
  }),
  z.object({ state: z.literal("rejected"), decision: decisionSchema }),
  z.object({ state: z.literal("expired"), finishedAt: time }),
  z.object({ state: z.literal("cancelled"), finishedAt: time }),
])

const previewSchema = z.object({
  title: z.string(),
  fields: z.array(z.object({ label: z.string(), value: z.string() })),
  body: z.string().optional(),
})

export const connectorActionSchema = z.object({
  id: z.string().min(1),
  botId: z.string().min(1),
  connectorId: z.string().min(1),
  tool: z.string().min(1),
  args: z.json(),
  preview: previewSchema,
  snapshot: z.json().optional(),
  connectionId: z.string().min(1).optional(),
  sessionId: z.string().min(1),
  createdAt: time,
  expiresAt: time,
  status: statusSchema,
})

export const permissionRecordSchema = z.object({
  botId: z.string().min(1),
  connectorId: z.string().min(1),
  tool: z.string().min(1),
  connectionId: z.string().min(1).optional(),
  permission: z.enum(CONNECTOR_PERMISSIONS),
  updatedAt: time,
})

export type PermissionRecord = z.infer<typeof permissionRecordSchema>

export function permissionRecordKey(
  botId: string,
  connectorId: string,
  tool: string,
  connectionId?: string,
): string {
  const key = `${botId}:${connectorId}:${tool}`
  return connectionId === undefined ? key : `${key}:${connectionId}`
}

export const settingsRecordSchema = z.object({
  botId: z.string().min(1),
  connectorId: z.string().min(1),
  enabled: z.boolean(),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  events: z.enum(CONNECTOR_EVENT_DELIVERIES).optional(),
  updatedAt: time,
})

export type SettingsRecord = z.infer<typeof settingsRecordSchema>

export function settingsRecordKey(botId: string, connectorId: string): string {
  return `${botId}:${connectorId}`
}

export const permissionChangeSchema = z.strictObject({
  connectorId: z.string().min(1),
  tool: z.string().min(1),
  permission: z.enum(CONNECTOR_PERMISSIONS).nullable(),
  connectionId: z.string().min(1).optional(),
})

export const CONNECTORS_DOMAIN = {
  name: "dsh_bot_connectors",
  version: 3,
  compatibleVersions: [1, 2],
  invalidRecords: "backup-and-skip",
  tables: {
    actions: { valueSchema: connectorActionSchema },
    permissions: { valueSchema: permissionRecordSchema },
    settings: { valueSchema: settingsRecordSchema },
  },
} as const
