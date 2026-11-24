/**
 * Telling bots' Main sessions of their connectors' new events (the `notify`
 * delivery): events arriving within one batch window go out as one notice
 * through the notice outbox (topic `event`), and are marked told once it is
 * stored. `queue` events wait for the bot's `<connector>_events_list`.
 */
import type { ConnectorEventDelivery } from "../../shared/connections"
import type { EventRecord } from "./domain"
import type { EventStore } from "./store"
import { type EventGroup, eventNotice } from "./texts"

export interface EventDeliveryDeps {
  store: Pick<EventStore, "unread" | "unreadStreams" | "notified" | "subscribe">
  /** How the bot gets the connector's events now. */
  delivery(botId: string, connectorId: string): ConnectorEventDelivery
  /** Registered connectors with events. */
  connectors(): readonly { readonly id: string; readonly name: string }[]
  /** How an account is named in the bot's text. */
  account(connectionId: string): string
  enqueue(botId: string, notice: { readonly text: string; readonly summary: string }): Promise<void>
  newNonce(): string
  later(ms: number, work: () => void): () => void
  readonly batchMs: number
  warn(message: string): void
}

export interface EventDelivery {
  /** Arm the batches of every bot with events nobody took (start-up). */
  start(): void
  /** A bot's delivery may have changed. */
  sync(botId: string): void
  dispose(): void
}

/** Events grouped by connector and account, oldest group first. */
export function groupEvents(
  events: readonly EventRecord[],
  connector: { readonly id: string; readonly name: string },
  account: (connectionId: string) => string,
): EventGroup[] {
  const groups = new Map<string, EventRecord[]>()
  for (const event of events) {
    const list = groups.get(event.connectionId) ?? []
    list.push(event)
    groups.set(event.connectionId, list)
  }
  return [...groups].map(([connectionId, list]) => ({
    connector,
    account: account(connectionId),
    events: list,
  }))
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createEventDelivery(deps: EventDeliveryDeps): EventDelivery {
  const timers = new Map<string, () => void>()
  let closed = false

  const flush = async (botId: string) => {
    const groups: EventGroup[] = []
    for (const connector of deps.connectors()) {
      if (deps.delivery(botId, connector.id) !== "notify") continue
      groups.push(...groupEvents(deps.store.unread(botId, connector.id), connector, deps.account))
    }
    const events = groups.flatMap((group) => group.events)
    if (events.length === 0) return
    await deps.enqueue(botId, eventNotice(groups, deps.newNonce()))
    await deps.store.notified(events.map((event) => event.id))
  }

  const arm = (botId: string) => {
    if (closed || timers.has(botId)) return
    timers.set(
      botId,
      deps.later(deps.batchMs, () => {
        timers.delete(botId)
        flush(botId).catch((error: unknown) => {
          deps.warn(
            `bot-core: could not tell bot "${botId}" of its connector events: ${messageOf(error)}`,
          )
        })
      }),
    )
  }

  const wants = (botId: string, connectorId: string) =>
    deps.delivery(botId, connectorId) === "notify" &&
    deps.store.unread(botId, connectorId).length > 0

  const off = deps.store.subscribe((botId, connectorId) => {
    if (wants(botId, connectorId)) arm(botId)
  })

  return {
    start() {
      for (const { botId, connectorId } of deps.store.unreadStreams()) {
        if (wants(botId, connectorId)) arm(botId)
      }
    },
    sync(botId) {
      if (deps.connectors().some((connector) => wants(botId, connector.id))) arm(botId)
    },
    dispose() {
      closed = true
      off()
      for (const cancel of timers.values()) cancel()
      timers.clear()
    },
  }
}
