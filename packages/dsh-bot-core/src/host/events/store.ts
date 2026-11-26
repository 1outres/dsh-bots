import type { ConnectorEvent } from "../../connector-contract"
import type { ConnectorJson } from "../../shared/connectors"
import type { BotTable } from "../registry"
import { type CursorRecord, cursorRecordKey, type EventRecord, eventRecordKey } from "./domain"

export interface EventStoreDeps {
  events: BotTable<EventRecord>
  cursors: BotTable<CursorRecord>
  newId(): string
  now(): number
  readonly maxPerStream: number
  readonly retentionMs: number
  readonly unreadRetentionMs: number
}

export interface EventArrival {
  readonly botIds: readonly string[]
  readonly connectorId: string
  readonly connectionId: string
  readonly events: readonly ConnectorEvent[]
  readonly gap?: string
}

export interface EventStore {
  receive(arrival: EventArrival, cursor: ConnectorJson): Promise<readonly string[]>
  admit(arrival: EventArrival): Promise<readonly string[]>
  cursor(connectionId: string, connectorId: string): ConnectorJson | undefined
  start(connectionId: string, connectorId: string, cursor: ConnectorJson): Promise<void>
  dropCursor(connectionId: string, connectorId: string): Promise<void>
  unread(botId: string, connectorId: string): readonly EventRecord[]
  unreadStreams(): readonly { readonly botId: string; readonly connectorId: string }[]
  notified(ids: readonly string[]): Promise<void>
  acknowledge(
    botId: string,
    connectorId: string,
    ids: readonly string[],
  ): Promise<readonly string[]>
  prune(keep: (botId: string, connectorId: string, connectionId: string) => boolean): Promise<void>
  pruneCursors(keep: (connectionId: string) => boolean): Promise<void>
  subscribe(listener: (botId: string, connectorId: string) => void): () => void
}

const MAX_SUMMARY = 500

const order = (a: EventRecord, b: EventRecord) =>
  a.receivedAt - b.receivedAt || Number(b.gap) - Number(a.gap) || a.occurredAt - b.occurredAt

export function createEventStore(deps: EventStoreDeps): EventStore {
  const listeners = new Set<(botId: string, connectorId: string) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const changed = (streams: Iterable<string>) => {
    for (const stream of streams) {
      const [botId, connectorId] = JSON.parse(stream) as [string, string]
      for (const listener of [...listeners]) listener(botId, connectorId)
    }
  }
  const all = () => [...deps.events.entries()].map(([, record]) => record)
  const keyOf = (record: EventRecord) =>
    eventRecordKey(record.botId, record.connectorId, record.connectionId, record.key)
  const streamOf = (botId: string, connectorId: string) => JSON.stringify([botId, connectorId])

  const gapRecord = (
    botId: string,
    connectorId: string,
    connectionId: string,
    reason: string,
  ): EventRecord => {
    const now = deps.now()
    const id = deps.newId()
    return {
      id,
      botId,
      connectorId,
      connectionId,
      key: `gap:${id}`,
      kind: "gap",
      occurredAt: now,
      receivedAt: now,
      summary: reason.slice(0, MAX_SUMMARY),
      ref: null,
      own: false,
      gap: true,
      state: "new",
    }
  }

  const trim = async (botId: string, connectorId: string, connectionId: string) => {
    const stream = all()
      .filter(
        (record) =>
          record.botId === botId &&
          record.connectorId === connectorId &&
          record.connectionId === connectionId,
      )
      .sort(order)
    const excess = stream.length - deps.maxPerStream
    if (excess <= 0) return
    const untaken = (record: EventRecord) => record.state === "new" && !record.gap
    const dropped = stream.slice(0, stream.slice(0, excess).some(untaken) ? excess + 1 : excess)
    const lost = dropped.filter(untaken).length
    for (const record of dropped) await deps.events.delete(keyOf(record))
    if (lost > 0) {
      const gap = gapRecord(
        botId,
        connectorId,
        connectionId,
        `${lost} older events were dropped before anyone took them: too many were waiting`,
      )
      await deps.events.put(keyOf(gap), gap)
    }
  }

  const put = async (arrival: EventArrival): Promise<readonly string[]> => {
    const now = deps.now()
    const fresh = new Set<string>()
    for (const botId of arrival.botIds) {
      if (arrival.gap !== undefined) {
        const gap = gapRecord(
          botId,
          arrival.connectorId,
          arrival.connectionId,
          `events may have been missed: ${arrival.gap}`,
        )
        await deps.events.put(keyOf(gap), gap)
        fresh.add(botId)
      }
      for (const event of arrival.events) {
        const key = eventRecordKey(botId, arrival.connectorId, arrival.connectionId, event.key)
        if (deps.events.get(key) !== undefined) continue
        await deps.events.put(key, {
          id: deps.newId(),
          botId,
          connectorId: arrival.connectorId,
          connectionId: arrival.connectionId,
          key: event.key,
          kind: event.kind,
          occurredAt: event.occurredAt,
          receivedAt: now,
          summary: event.summary.slice(0, MAX_SUMMARY),
          ref: event.ref,
          own: event.own === true,
          gap: false,
          state: event.own === true ? "acked" : "new",
          ...(event.sender === undefined ? {} : { sender: event.sender }),
        })
        if (event.own !== true) fresh.add(botId)
      }
      await trim(botId, arrival.connectorId, arrival.connectionId)
    }
    return [...fresh]
  }

  return {
    receive(arrival, cursor) {
      return serial(async () => {
        const bots = await put(arrival)
        await deps.cursors.put(cursorRecordKey(arrival.connectionId, arrival.connectorId), {
          connectionId: arrival.connectionId,
          connectorId: arrival.connectorId,
          cursor,
          updatedAt: deps.now(),
        })
        changed(bots.map((botId) => streamOf(botId, arrival.connectorId)))
        return bots
      })
    },
    admit(arrival) {
      return serial(async () => {
        const bots = await put(arrival)
        changed(bots.map((botId) => streamOf(botId, arrival.connectorId)))
        return bots
      })
    },
    cursor: (connectionId, connectorId) =>
      deps.cursors.get(cursorRecordKey(connectionId, connectorId))?.cursor,
    start(connectionId, connectorId, cursor) {
      return serial(() =>
        deps.cursors.put(cursorRecordKey(connectionId, connectorId), {
          connectionId,
          connectorId,
          cursor,
          updatedAt: deps.now(),
        }),
      )
    },
    dropCursor(connectionId, connectorId) {
      return serial(async () => {
        await deps.cursors.delete(cursorRecordKey(connectionId, connectorId))
      })
    },
    unread: (botId, connectorId) =>
      all()
        .filter(
          (record) =>
            record.botId === botId && record.connectorId === connectorId && record.state === "new",
        )
        .sort(order),
    unreadStreams() {
      const streams = new Set(
        all()
          .filter((record) => record.state === "new")
          .map((record) => streamOf(record.botId, record.connectorId)),
      )
      return [...streams].map((stream) => {
        const [botId, connectorId] = JSON.parse(stream) as [string, string]
        return { botId, connectorId }
      })
    },
    notified(ids) {
      return serial(async () => {
        const wanted = new Set(ids)
        const streams = new Set<string>()
        for (const record of all()) {
          if (!wanted.has(record.id) || record.state !== "new") continue
          await deps.events.put(keyOf(record), { ...record, state: "notified" })
          streams.add(streamOf(record.botId, record.connectorId))
        }
        changed(streams)
      })
    },
    acknowledge(botId, connectorId, ids) {
      return serial(async () => {
        const wanted = new Set(ids)
        const acked: string[] = []
        for (const record of all()) {
          if (
            record.botId !== botId ||
            record.connectorId !== connectorId ||
            !wanted.has(record.id) ||
            record.state === "acked"
          ) {
            continue
          }
          await deps.events.put(keyOf(record), { ...record, state: "acked" })
          acked.push(record.id)
        }
        if (acked.length > 0) changed([streamOf(botId, connectorId)])
        return acked
      })
    },
    prune(keep) {
      return serial(async () => {
        const now = deps.now()
        const streams = new Set<string>()
        for (const record of all()) {
          const limit = record.state === "new" ? deps.unreadRetentionMs : deps.retentionMs
          if (
            keep(record.botId, record.connectorId, record.connectionId) &&
            now - record.receivedAt <= limit
          ) {
            continue
          }
          await deps.events.delete(keyOf(record))
          if (record.state === "new") streams.add(streamOf(record.botId, record.connectorId))
        }
        changed(streams)
      })
    },
    pruneCursors(keep) {
      return serial(async () => {
        for (const [key, record] of [...deps.cursors.entries()]) {
          if (!keep(record.connectionId)) await deps.cursors.delete(key)
        }
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
