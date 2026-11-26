import type { BotConnectorEvents, ConnectorEvent, ConnectorJson } from "@1outres/dsh-bot-core"
import type { calendar_v3 } from "@googleapis/calendar"
import { type Google, googleStatus } from "../google"
import { oneLine } from "../kit"
import type { OwnChanges } from "./own"
import { showTime } from "./times"

export const EVENT_CREATED = "gcal.event.created"
export const EVENT_UPDATED = "gcal.event.updated"
export const EVENT_CANCELLED = "gcal.event.cancelled"

const CREATED_WITHIN_MS = 5_000
const MAX_SYNC_PAGES = 100

interface Cursor {
  readonly calendars: Readonly<Record<string, string>>
}

const cursorOf = (value: ConnectorJson | undefined): Cursor | undefined => {
  const calendars = (value as { calendars?: unknown } | null | undefined)?.calendars
  if (typeof calendars !== "object" || calendars === null || Array.isArray(calendars))
    return undefined
  return {
    calendars: Object.fromEntries(
      Object.entries(calendars).filter(([, token]) => typeof token === "string"),
    ),
  }
}

async function listAll(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  syncToken: string | undefined,
) {
  const items: calendar_v3.Schema$Event[] = []
  let pageToken: string | undefined
  for (let page = 0; ; page += 1) {
    const response = await calendar.events.list({
      calendarId,
      showDeleted: true,
      maxResults: 250,
      ...(syncToken === undefined ? {} : { syncToken }),
      ...(pageToken === undefined ? {} : { pageToken }),
    })
    if (syncToken !== undefined) items.push(...(response.data.items ?? []))
    pageToken = response.data.nextPageToken ?? undefined
    if (pageToken === undefined) {
      const next = response.data.nextSyncToken
      if (!next) throw new Error(`the calendar ${calendarId} returned no sync token`)
      return { items, syncToken: next }
    }
    if (page >= MAX_SYNC_PAGES)
      throw new Error(`the calendar ${calendarId} has too many pages to sync`)
  }
}

function kindOf(event: calendar_v3.Schema$Event): string {
  if (event.status === "cancelled") return EVENT_CANCELLED
  const created = Date.parse(event.created ?? "")
  const updated = Date.parse(event.updated ?? "")
  return Number.isFinite(created) &&
    Number.isFinite(updated) &&
    updated - created <= CREATED_WITHIN_MS
    ? EVENT_CREATED
    : EVENT_UPDATED
}

export function calendarEvents(google: Google, own: OwnChanges): BotConnectorEvents {
  return {
    kinds: [
      { kind: EVENT_CREATED, label: { en: "Event created", ja: "予定の追加" } },
      { kind: EVENT_UPDATED, label: { en: "Event changed", ja: "予定の変更" } },
      {
        kind: EVENT_CANCELLED,
        label: { en: "Event cancelled or deleted", ja: "予定の取り消し・削除" },
      },
    ],
    delivery: "notify",
    intervalMs: 120_000,
    poll: (source, value) =>
      google.as(source.connection, async ({ calendar }) => {
        const cursor = cursorOf(value)
        const list = await calendar.calendarList.list({ minAccessRole: "writer" })
        const ids = (list.data.items ?? []).flatMap((item) => (item.id ? [item.id] : []))
        const tokens: Record<string, string> = {}
        const events: ConnectorEvent[] = []
        const gaps: string[] = []
        for (const calendarId of ids) {
          const previous = cursor?.calendars[calendarId]
          if (previous === undefined) {
            tokens[calendarId] = (await listAll(calendar, calendarId, undefined)).syncToken
            continue
          }
          let synced: Awaited<ReturnType<typeof listAll>>
          try {
            synced = await listAll(calendar, calendarId, previous)
          } catch (error) {
            if (googleStatus(error) !== 410) throw error
            tokens[calendarId] = (await listAll(calendar, calendarId, undefined)).syncToken
            gaps.push(calendarId)
            continue
          }
          tokens[calendarId] = synced.syncToken
          for (const item of synced.items) {
            if (!item.id) continue
            const kind = kindOf(item)
            events.push({
              key: `gcal:${calendarId}:${item.id}:${item.updated ?? item.status ?? ""}`,
              kind,
              occurredAt: Date.parse(item.updated ?? "") || 0,
              summary: oneLine(
                kind === EVENT_CANCELLED
                  ? `Cancelled: ${item.summary ?? item.id} (calendar ${calendarId})`
                  : `${item.summary ?? "(no title)"} · ${showTime(item.start ?? undefined)} → ${showTime(item.end ?? undefined)} · organizer ${item.organizer?.email ?? "?"} (calendar ${calendarId})`,
              ),
              ref: { calendar_id: calendarId, event_id: item.id },
              ...(own.isOwn(source.connection.info.id, item.id) ? { own: true } : {}),
            })
          }
        }
        return {
          events,
          cursor: { calendars: tokens },
          ...(gaps.length === 0
            ? {}
            : { gap: `Calendar's sync of ${gaps.join(", ")} expired and was started again` }),
        }
      }),
  }
}
