import { describe, expect, it } from "vitest"
import {
  createNoticeDelivery,
  handOffOf,
  type NoticeAgent,
  type NoticeMessage,
} from "../src/host/notices/delivery"
import type { NoticeRecord } from "../src/host/notices/domain"
import { createNoticeOutbox } from "../src/host/notices/outbox"
import { memoryTable } from "./channels-support"
import { manualClock, settle } from "./connectors-support"

/** A Main session Agent: its inbox and recorded history, and what it was handed. */
function fakeAgent() {
  const state = {
    status: "idle" as "idle" | "running",
    inbox: [] as NoticeMessage[],
    history: [] as string[],
    handed: [] as string[],
  }
  const agent: NoticeAgent = {
    get status() {
      return state.status
    },
    queued: (id) => state.inbox.some((message) => message.id === id),
    unqueue(id) {
      state.inbox = state.inbox.filter((message) => message.id !== id)
    },
    recorded: (id) => state.history.includes(id),
    followup(message) {
      state.handed.push(`followup ${message.id}`)
      state.inbox.push(message)
      state.status = "running"
    },
    inject(message) {
      state.handed.push(`inject ${message.id}`)
      state.inbox.push(message)
    },
  }
  /** The turn claims and records every queued message. */
  const record = () => {
    for (const message of state.inbox) state.history.push(message.id)
    const ids = state.inbox.map((message) => message.id)
    state.inbox = []
    return ids
  }
  return { state, agent, record }
}

function setup(stored: [string, NoticeRecord][] = []) {
  const clock = manualClock()
  const notices = memoryTable<NoticeRecord>()
  for (const [id, record] of stored) notices.rows.set(id, record)
  let ids = 0
  const outbox = createNoticeOutbox({ notices, newId: () => `id-${++ids}`, now: clock.now })
  const main = fakeAgent()
  const next = fakeAgent()
  const flags = { archived: false, failResolve: false, main: "main-1" }
  const resolved: string[] = []
  const delivery = createNoticeDelivery({
    outbox,
    admit: (botId, work) => work(botId === "b1" ? flags.main : undefined),
    archived: () => flags.archived,
    ready: async () => {},
    async resolve(sessionId) {
      resolved.push(sessionId)
      if (flags.failResolve) throw new Error("cannot resume")
      return sessionId === "main-1" ? main.agent : next.agent
    },
    hand: (work) => work(),
    later: clock.later,
    retry: { initialMs: 1_000, maxMs: 4_000 },
    warn: () => {},
  })
  return { clock, notices, outbox, main, next, flags, delivery, resolved }
}

const text = { text: "[BOT CONNECTOR NOTICE] done", summary: "mail_send approved and ran" }

describe("notice outbox and delivery", () => {
  it("stores a notice first, wakes an idle Main with it, and drops it once recorded", async () => {
    const { outbox, main, delivery, notices } = setup()
    const entry = await outbox.enqueue("b1", "connector", text)
    expect(notices.rows.get(entry.id)).toMatchObject({ botId: "b1", messageId: entry.messageId })
    await settle()
    expect(main.state.handed).toEqual([`followup ${entry.messageId}`])
    expect(main.state.inbox[0]).toEqual({
      id: entry.messageId,
      role: "user",
      content: [{ type: "text", text: text.text }],
      source: { kind: "bot-connector", form: "notice", summary: text.summary },
    })
    for (const id of main.record()) delivery.recorded(id)
    await settle()
    expect(notices.rows.size).toBe(0)
  })

  it("sends a notice the former Main never recorded to the new Main", async () => {
    const { outbox, main, next, flags, delivery, notices } = setup()
    const entry = await outbox.enqueue("b1", "connector", text)
    await settle()
    expect(main.state.handed).toEqual([`followup ${entry.messageId}`])
    main.state.inbox = []
    main.state.status = "idle"
    flags.main = "main-2"
    delivery.mainChanged("b1")
    await settle()
    expect(next.state.handed).toEqual([`followup ${entry.messageId}`])
    for (const id of next.record()) delivery.recorded(id)
    await settle()
    expect(notices.rows.size).toBe(0)
  })

  it("injects into a running Main without waking it", async () => {
    const { outbox, main } = setup()
    main.state.status = "running"
    const entry = await outbox.enqueue("b1", "connector", text)
    await settle()
    expect(main.state.handed).toEqual([`inject ${entry.messageId}`])
  })

  it("queues a schedule notice for its own turn after the running one, never into it", async () => {
    const { outbox, main } = setup()
    main.state.status = "running"
    const entry = await outbox.enqueue("b1", "schedule", {
      text: '[schedule] "Digest" (job-1)',
      summary: 'Schedule "Digest": run',
    })
    await settle()
    expect(main.state.handed).toEqual([`followup ${entry.messageId}`])
    expect(main.state.inbox[0]?.source.kind).toBe("bot-schedule")
  })

  it("queues a file notice for its own turn, from its own source", async () => {
    const { outbox, main } = setup()
    main.state.status = "running"
    const entry = await outbox.enqueue("b1", "file", {
      text: "1 file you presented did not reach every chat channel connected to you:",
      summary: "1 file you presented did not reach every chat channel",
    })
    await settle()
    expect(main.state.handed).toEqual([`followup ${entry.messageId}`])
    expect(main.state.inbox[0]?.source.kind).toBe("bot-file")
  })

  it("leaves a schedule notice waiting while the turn runs, and re-sends it once dropped", async () => {
    const { outbox, main, delivery, clock } = setup()
    main.state.status = "running"
    const waiting = await outbox.enqueue("b1", "schedule", { text: "s", summary: "s" })
    await settle()
    // Another notice makes a pass while the schedule one still waits in the inbox.
    const connector = await outbox.enqueue("b1", "connector", text)
    await settle()
    expect(main.state.handed).toEqual([
      `followup ${waiting.messageId}`,
      `inject ${connector.messageId}`,
    ])
    // A cancel drops the inbox while the turn still runs: nothing is sent yet.
    main.state.inbox = []
    await outbox.enqueue("b1", "connector", text)
    await settle()
    expect(main.state.handed.filter((line) => line.endsWith(waiting.messageId))).toHaveLength(1)
    // Once idle, the dropped one is sent again (after the backoff), as its own turn.
    main.state.status = "idle"
    delivery.idle("main-1")
    await clock.advance(1_000)
    expect(main.state.handed.filter((line) => line.endsWith(waiting.messageId))).toEqual([
      `followup ${waiting.messageId}`,
      `followup ${waiting.messageId}`,
    ])
  })

  it("hands a notice by its topic's timing", () => {
    expect(handOffOf("next-step", "running")).toBe("inject")
    expect(handOffOf("next-turn", "running")).toBe("followup")
    expect(handOffOf("next-step", "idle")).toBe("followup")
    expect(handOffOf("next-turn", "idle")).toBe("followup")
  })

  it("sends a notice the turn dropped again with the same message id, after a backoff", async () => {
    const { outbox, main, delivery, clock } = setup()
    const entry = await outbox.enqueue("b1", "connector", text)
    await settle()
    // The turn claimed it but failed before recording it.
    main.state.inbox = []
    main.state.status = "idle"
    delivery.idle("main-1")
    await settle()
    expect(main.state.handed).toHaveLength(1)
    await clock.advance(1_000)
    expect(main.state.handed).toEqual([
      `followup ${entry.messageId}`,
      `followup ${entry.messageId}`,
    ])
  })

  it("re-sends undelivered notices after a restart, never twice", async () => {
    const stored: [string, NoticeRecord][] = [
      [
        "n1",
        { botId: "b1", topic: "connector", messageId: "m1", text: "a", summary: "a", createdAt: 1 },
      ],
      [
        "n2",
        { botId: "b1", topic: "connector", messageId: "m2", text: "b", summary: "b", createdAt: 2 },
      ],
      [
        "n3",
        { botId: "b1", topic: "connector", messageId: "m3", text: "c", summary: "c", createdAt: 3 },
      ],
    ]
    const { main, delivery, notices } = setup(stored)
    // m1 was recorded before the restart; m2 still waits in the restored inbox.
    main.state.history.push("m1")
    main.state.inbox.push({ id: "m2" } as NoticeMessage)
    delivery.start()
    await settle()
    expect(notices.rows.has("n1")).toBe(false)
    expect(main.state.handed).toEqual(["followup m2", "inject m3"])
    expect(main.state.inbox.map((message) => message.id)).toEqual(["m2", "m3"])
  })

  it("waits while the Main is archived or cannot be resumed, then delivers", async () => {
    const { outbox, main, flags, clock, resolved } = setup()
    flags.archived = true
    await outbox.enqueue("b1", "connector", text)
    await settle()
    expect(resolved).toEqual([])
    flags.archived = false
    flags.failResolve = true
    await clock.advance(1_000)
    expect(resolved).toEqual(["main-1"])
    flags.failResolve = false
    await clock.advance(2_000)
    expect(main.state.handed).toHaveLength(1)
  })

  it("keeps a notice of a bot without a Main, and forgets deleted bots' notices", async () => {
    const { outbox, notices } = setup()
    await outbox.enqueue("b2", "connector", text)
    await settle()
    expect(notices.rows.size).toBe(1)
    await outbox.purge((botId) => botId !== "b2")
    expect(notices.rows.size).toBe(0)
  })
})
