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

/** A decision as it arrives from a surface (untrusted). */
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

/** One connector action of a bot, keyed by its id. */
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

/** A bot's permission override of one tool (for one of its accounts, with `connectionId`), keyed by {@link permissionRecordKey}. */
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

/** A bot's settings of one connector, keyed by {@link settingsRecordKey}. */
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

/** A permission change as it arrives from a surface (untrusted). */
export const permissionChangeSchema = z.strictObject({
  connectorId: z.string().min(1),
  tool: z.string().min(1),
  permission: z.enum(CONNECTOR_PERMISSIONS).nullable(),
  connectionId: z.string().min(1).optional(),
})

/**
 * Bots' connector actions, tool permissions and connector settings, apart
 * from the bot records (design rule 27). Version 2 added the `settings`
 * table and the optional `snapshot` and `text` of actions. Version 3
 * decides only through the owner's surfaces: a decision's origin is the Web
 * UI or a channel with its name, never a Host plugin. Records of the earlier
 * versions are read with the current schema; one decided by a Host plugin
 * (no surface decided before version 3) is backed up and skipped.
 */
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
