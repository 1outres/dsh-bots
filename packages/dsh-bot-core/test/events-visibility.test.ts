import { describe, expect, it } from "vitest"
import type { EventRecord } from "../src/host/events/domain"
import { createEventStore } from "../src/host/events/store"
import { eventVisible, visibleEvents } from "../src/host/events/visibility"
import type { ConnectorSender, SenderPolicy } from "../src/shared/senders"
import { memoryTable } from "./channels-support"

const carol: ConnectorSender = { kind: "external", address: "carol@example.com", verified: true }

function setup(policy: { current: SenderPolicy | undefined }) {
  const store = createEventStore({
    events: memoryTable(),
    cursors: memoryTable(),
    newId: (() => {
      let n = 0
      return () => `evt-${++n}`
    })(),
    now: () => 1,
    maxPerStream: 100,
    retentionMs: 1000,
    unreadRetentionMs: 1000,
  })
  const deps = {
    screened: (connectorId: string) => connectorId === "gmail",
    policy: () => policy.current,
  }
  return { store, deps, shown: visibleEvents(store, deps) }
}

const arrival = (connectorId: string, sender?: ConnectorSender) => ({
  botIds: ["a"],
  connectorId,
  connectionId: "c1",
  events: [
    {
      key: `${connectorId}-1`,
      kind: "message",
      occurredAt: 1,
      summary: "Lunch?",
      ref: null,
      ...(sender === undefined ? {} : { sender }),
    },
  ],
})

describe("visible connector events", () => {
  it("keeps the sender of an event and hides it once the policy no longer admits it", async () => {
    const policy: { current: SenderPolicy | undefined } = {
      current: { unknown: "allow", rules: [] },
    }
    const { store, shown } = setup(policy)
    await store.receive(arrival("gmail", carol), null)
    expect(store.unread("a", "gmail")[0]?.sender).toEqual(carol)
    expect(shown.unread("a", "gmail")).toHaveLength(1)
    expect(shown.unreadStreams()).toEqual([{ botId: "a", connectorId: "gmail" }])
    policy.current = {
      unknown: "allow",
      rules: [
        {
          match: { kind: "address", value: "carol@example.com" },
          verdict: "deny",
          decidedAt: 1,
          origin: { kind: "web" },
        },
      ],
    }
    expect(shown.unread("a", "gmail")).toEqual([])
    expect(shown.unreadStreams()).toEqual([])
    const id = store.unread("a", "gmail")[0]?.id as string
    expect(await shown.acknowledge("a", "gmail", [id])).toEqual([])
    policy.current = undefined
    expect(shown.unread("a", "gmail")).toEqual([])
  })

  it("shows events of connectors without senders, gaps, and judges an event without a sender as unreadable", async () => {
    const policy: { current: SenderPolicy | undefined } = { current: { unknown: "ask", rules: [] } }
    const { store, deps, shown } = setup(policy)
    await store.receive(arrival("calendar"), null)
    expect(shown.unread("a", "calendar")).toHaveLength(1)
    const stored = (overrides: Partial<EventRecord>): EventRecord => ({
      id: "x",
      botId: "a",
      connectorId: "gmail",
      connectionId: "c1",
      key: "k",
      kind: "message",
      occurredAt: 1,
      receivedAt: 1,
      summary: "",
      ref: null,
      own: false,
      gap: false,
      state: "new",
      ...overrides,
    })
    expect(eventVisible(deps, stored({}))).toBe(false)
    expect(eventVisible(deps, stored({ gap: true }))).toBe(true)
    policy.current = { unknown: "allow", rules: [] }
    expect(eventVisible(deps, stored({}))).toBe(true)
  })
})
