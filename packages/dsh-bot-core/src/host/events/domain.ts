import { z } from "zod"
import type { ConnectorJson } from "../../shared/connectors"
import { connectorSenderSchema } from "../senders/domain"

const time = z.number().int().nonnegative()

export const EVENT_STATES = ["new", "notified", "acked"] as const

export type EventState = (typeof EVENT_STATES)[number]

export const eventRecordSchema = z.object({
  id: z.string().min(1),
  botId: z.string().min(1),
  connectorId: z.string().min(1),
  connectionId: z.string().min(1),
  key: z.string().min(1),
  kind: z.string().min(1),
  occurredAt: time,
  receivedAt: time,
  summary: z.string(),
  ref: z.json(),
  own: z.boolean(),
  gap: z.boolean(),
  state: z.enum(EVENT_STATES),
  sender: connectorSenderSchema.optional(),
})

export type EventRecord = Omit<z.infer<typeof eventRecordSchema>, "ref"> & {
  readonly ref: ConnectorJson
}

export function eventRecordKey(
  botId: string,
  connectorId: string,
  connectionId: string,
  key: string,
): string {
  return JSON.stringify([botId, connectorId, connectionId, key])
}

export const cursorRecordSchema = z.object({
  connectionId: z.string().min(1),
  connectorId: z.string().min(1),
  cursor: z.json(),
  updatedAt: time,
})

export type CursorRecord = Omit<z.infer<typeof cursorRecordSchema>, "cursor"> & {
  readonly cursor: ConnectorJson
}

export function cursorRecordKey(connectionId: string, connectorId: string): string {
  return `${connectionId}:${connectorId}`
}

export const EVENTS_DOMAIN = {
  name: "dsh_bot_connector_events",
  version: 1,
  invalidRecords: "backup-and-skip",
  tables: {
    events: { valueSchema: eventRecordSchema },
    cursors: { valueSchema: cursorRecordSchema },
  },
} as const
