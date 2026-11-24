import { z } from "zod"
import type { ConnectorJson } from "../../shared/connectors"

const time = z.number().int().nonnegative()

/** The states of a stored event: `new` until the bot is told of it or acknowledges it. */
export const EVENT_STATES = ["new", "notified", "acked"] as const

export type EventState = (typeof EVENT_STATES)[number]

/** One event of a bot's connector account, keyed by {@link eventRecordKey}. */
export const eventRecordSchema = z.object({
  /** `evt-<hex>`, what the bot acknowledges. */
  id: z.string().min(1),
  botId: z.string().min(1),
  connectorId: z.string().min(1),
  connectionId: z.string().min(1),
  /** The connector's deduplication key; a gap's own key. */
  key: z.string().min(1),
  kind: z.string().min(1),
  occurredAt: time,
  receivedAt: time,
  summary: z.string(),
  ref: z.json(),
  own: z.boolean(),
  /** Events may have been missed before this one; `summary` says why. */
  gap: z.boolean(),
  state: z.enum(EVENT_STATES),
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

/** Where a connector's polling of one account resumes, keyed by {@link cursorRecordKey}. */
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

/**
 * Connectors' events per bot and account, and the polling cursors per
 * account (design rule 27). Only host/events/store.ts writes it (design rule 49).
 */
export const EVENTS_DOMAIN = {
  name: "dsh_bot_connector_events",
  version: 1,
  invalidRecords: "backup-and-skip",
  tables: {
    events: { valueSchema: eventRecordSchema },
    cursors: { valueSchema: cursorRecordSchema },
  },
} as const
