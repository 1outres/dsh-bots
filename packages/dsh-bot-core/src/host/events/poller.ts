import type {
  BotConnectorConnection,
  BotConnectorPoll,
  ConnectorEvent,
} from "../../connector-contract"
import type { ConnectorJson } from "../../shared/connectors"
import type { ConnectionRecord } from "../connections/domain"
import type { ConnectionStore } from "../connections/store"
import type { CatalogConnector, ConnectorCatalog } from "../connectors/catalog"
import type { EventStore } from "./store"

export interface EventPollerDeps {
  catalog: Pick<ConnectorCatalog, "list">
  connections: Pick<ConnectionStore, "list">
  subscribers(connectionId: string, connector: CatalogConnector): readonly string[]
  store: Pick<EventStore, "cursor" | "start" | "receive" | "dropCursor">
  shield(botId: string, events: readonly ConnectorEvent[]): Promise<readonly ConnectorEvent[]>
  connection(record: ConnectionRecord): BotConnectorConnection
  later(ms: number, work: () => void): () => void
  deadline(ms: number): AbortSignal
  now(): number
  warn(message: string): void
}

export interface EventStreamStatus {
  readonly lastPolledAt?: number
  readonly lastError?: string
}

export interface EventPoller {
  sync(): void
  status(connectionId: string, connectorId: string): EventStreamStatus | undefined
  dispose(): void
}

const POLL_TIMEOUT_MS = 120_000

interface Stream {
  readonly connectionId: string
  readonly connector: CatalogConnector
  readonly controller: AbortController
  cancel: () => void
  status: EventStreamStatus
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function isJson(value: unknown, depth = 0): value is ConnectorJson {
  if (depth > 64) return false
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isJson(item, depth + 1))
  if (typeof value !== "object") return false
  return Object.values(value).every((item) => isJson(item, depth + 1))
}

function pollProblem(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return "the poll returned no result"
  const { events, cursor, gap } = result as Partial<BotConnectorPoll>
  if (!Array.isArray(events)) return "the poll's events are not a list"
  if (!isJson(cursor)) return "the poll's cursor is not JSON"
  if (gap !== undefined && typeof gap !== "string") return "the poll's gap is not text"
  for (const event of events) {
    if (
      typeof event !== "object" ||
      event === null ||
      typeof event.key !== "string" ||
      event.key === "" ||
      typeof event.kind !== "string" ||
      typeof event.summary !== "string" ||
      !Number.isFinite(event.occurredAt) ||
      !isJson(event.ref)
    ) {
      return "the poll returned an event that is not one"
    }
  }
  return undefined
}

export function createEventPoller(deps: EventPollerDeps): EventPoller {
  const streams = new Map<string, Stream>()
  let closed = false
  const keyOf = (connectionId: string, connectorId: string) => `${connectionId}\u0000${connectorId}`

  const poll = async (stream: Stream) => {
    const { connector, connectionId } = stream
    const events = connector.events
    const record = deps.connections.list().find((item) => item.id === connectionId)
    if (events === undefined || record === undefined) return
    const signal = AbortSignal.any([stream.controller.signal, deps.deadline(POLL_TIMEOUT_MS)])
    const cursor = deps.store.cursor(connectionId, connector.id)
    const result: unknown = await events.poll(
      { connection: deps.connection(record), signal },
      cursor,
    )
    const problem = pollProblem(result)
    if (problem !== undefined) throw new Error(problem)
    const polled = result as BotConnectorPoll
    if (stream.controller.signal.aborted) return
    if (cursor === undefined) {
      await deps.store.start(connectionId, connector.id, polled.cursor)
      return
    }
    const botIds = deps.subscribers(connectionId, connector)
    let kept: readonly ConnectorEvent[] = polled.events
    for (const botId of botIds) kept = await deps.shield(botId, kept)
    await deps.store.receive(
      {
        botIds,
        connectorId: connector.id,
        connectionId,
        events: kept,
        ...(polled.gap === undefined ? {} : { gap: polled.gap }),
      },
      polled.cursor,
    )
  }

  const run = (stream: Stream) => {
    void poll(stream)
      .then(
        () => {
          stream.status = { lastPolledAt: deps.now() }
        },
        (error: unknown) => {
          const message = messageOf(error)
          if (stream.status.lastError !== message) {
            deps.warn(
              `bot-core: could not poll ${stream.connector.name} events of connection "${stream.connectionId}": ${message}`,
            )
          }
          stream.status = { ...stream.status, lastError: message }
        },
      )
      .finally(() => {
        if (closed || stream.controller.signal.aborted) return
        const interval = stream.connector.events?.intervalMs
        if (interval === undefined) return
        stream.cancel = deps.later(interval, () => run(stream))
      })
  }

  const stop = (key: string, stream: Stream) => {
    stream.controller.abort()
    stream.cancel()
    streams.delete(key)
  }

  return {
    sync() {
      if (closed) return
      const wanted = new Map<string, { connectionId: string; connector: CatalogConnector }>()
      const forgotten: { connectionId: string; connectorId: string }[] = []
      const connections = deps.connections.list()
      for (const connector of deps.catalog.list()) {
        if (connector.events === undefined || connector.connections === undefined) continue
        for (const record of connections) {
          if (record.provider !== connector.connections.provider) continue
          if (deps.subscribers(record.id, connector).length === 0) {
            forgotten.push({ connectionId: record.id, connectorId: connector.id })
            continue
          }
          if (record.status !== "active" || !record.services.includes(connector.id)) continue
          wanted.set(keyOf(record.id, connector.id), { connectionId: record.id, connector })
        }
      }
      for (const [key, stream] of [...streams]) {
        const next = wanted.get(key)
        if (next === undefined || next.connector !== stream.connector) stop(key, stream)
      }
      for (const [key, entry] of wanted) {
        if (streams.has(key)) continue
        const stream: Stream = {
          ...entry,
          controller: new AbortController(),
          cancel: () => {},
          status: {},
        }
        streams.set(key, stream)
        run(stream)
      }
      for (const { connectionId, connectorId } of forgotten) {
        if (deps.store.cursor(connectionId, connectorId) === undefined) continue
        deps.store.dropCursor(connectionId, connectorId).catch((error: unknown) => {
          deps.warn(`bot-core: could not forget an events cursor: ${messageOf(error)}`)
        })
      }
    },
    status: (connectionId, connectorId) => streams.get(keyOf(connectionId, connectorId))?.status,
    dispose() {
      closed = true
      for (const [key, stream] of [...streams]) stop(key, stream)
    },
  }
}
