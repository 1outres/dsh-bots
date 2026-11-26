import { describe, expect, it } from "vitest"
import { createNoticeDelivery, type NoticeAgent } from "../src/host/notices/delivery"
import type { NoticeRecord, NoticeSpace } from "../src/host/notices/domain"
import { createNoticeOutbox } from "../src/host/notices/outbox"
import { createSpaceEvents } from "../src/host/spaces/events"
import { SPACE_LIMITS, type SpaceRecord, spaceIdOf } from "../src/shared/spaces"
import { memoryTable } from "./support/skills-fs"
import { call, spacesHarness } from "./support/spaces"

const ID = spaceIdOf("b1", "demo")

const SPACE: SpaceRecord = {
  botId: "b1",
  slug: "demo",
  title: "Demo",
  description: "",
  pinned: false,
  visibility: "public",
  visitorWrites: false,
  source: { kind: "snapshot", revision: 1 },
  createdAt: 1,
  updatedAt: 1,
}

function events() {
  const queued: { text: string; space: NoticeSpace }[] = []
  const timers: { work: () => void; cancelled: boolean }[] = []
  const clock = { now: 0 }
  const subject = createSpaceEvents({
    async enqueue(_botId, notice, space) {
      queued.push({ text: notice.text, space })
    },
    async withdraw(matches) {
      const gone = queued.filter((entry) => matches(entry.space))
      for (const entry of gone) queued.splice(queued.indexOf(entry), 1)
      return gone.reduce((sum, entry) => sum + entry.space.events, 0)
    },
    pending: () => queued.reduce((sum, entry) => sum + entry.space.events, 0),
    newNonce: () => "n0nce",
    later(_ms, work) {
      const timer = { work, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    now: () => clock.now,
    warn: () => {},
  })
  const flush = () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.work()
  }
  return { subject, queued, flush, clock }
}

describe("page events", () => {
  it("bundle public operations apart from the owner's, with the stranger line", async () => {
    const { subject, queued, flush } = events()
    subject.accept(SPACE, "owner", "save", { a: 1 })
    subject.accept(SPACE, "public", "vote", "b\u0007")
    subject.accept(SPACE, "link", "save", null)
    flush()
    await Promise.resolve()
    expect(queued.map((entry) => entry.space)).toEqual([
      { spaceId: ID, public: false, events: 2 },
      { spaceId: ID, public: true, events: 1 },
    ])
    expect(queued[1]?.text).toContain("strangers visiting the public page")
    expect(queued[1]?.text).toContain('· public · vote · "b\\u0007"')
    expect(queued[0]?.text).not.toContain("strangers")
    expect(queued[0]?.text).toContain("<<<space-data n0nce")
  })

  it("limit the rate, the public share and the queue", async () => {
    const { subject, clock } = events()
    for (let index = 0; index < SPACE_LIMITS.publicEventsPerMinute; index += 1) {
      expect(subject.accept(SPACE, "public", "x", null)).toEqual({ accepted: true })
    }
    expect(subject.accept(SPACE, "public", "x", null)).toEqual({
      accepted: false,
      reason: "rate-limited",
    })
    expect(subject.accept(SPACE, "owner", "x", null)).toEqual({ accepted: true })
    clock.now += 60_001
    const second = events()
    for (let index = 0; index < SPACE_LIMITS.eventsPerMinute; index += 1)
      second.subject.accept(SPACE, "owner", "x", null)
    expect(second.subject.accept(SPACE, "owner", "x", null)).toEqual({
      accepted: false,
      reason: "rate-limited",
    })
  })

  it("drop the visitors' operations not yet delivered when the Space stops being public", async () => {
    const { subject, queued, flush } = events()
    subject.accept(SPACE, "public", "a", null)
    subject.accept(SPACE, "owner", "b", null)
    flush()
    await Promise.resolve()
    subject.accept(SPACE, "public", "c", null)
    expect(await subject.discard(ID, "public")).toBe(2)
    flush()
    expect(queued.map((entry) => entry.space.public)).toEqual([false])
  })

  it("are dropped when the owner makes the Space owner only", async () => {
    const h = await spacesHarness({ baseUrl: "https://dsh.example/" })
    await call(h, "space_create", { space: "demo", title: "Demo" })
    await h.spaces.manager.setVisibility(ID, "public", "owner")
    h.queued.push({
      botId: "b1",
      text: "t",
      summary: "s",
      space: { spaceId: ID, public: true, events: 3 },
    })
    h.queued.push({
      botId: "b1",
      text: "t",
      summary: "s",
      space: { spaceId: ID, public: false, events: 1 },
    })
    await h.spaces.manager.setVisibility(ID, "owner", "owner")
    expect(h.queued.map((entry) => entry.space.public)).toEqual([false])
  })
})

describe("withdrawing space notices", () => {
  it("removes them from the outbox and from the Main's inbox while they wait", async () => {
    const notices = memoryTable<NoticeRecord>()
    let id = 0
    const outbox = createNoticeOutbox({
      notices,
      shield: async (_botId, notice) => notice,
      newId: () => {
        id += 1
        return `n${id}`
      },
      now: () => 1,
    })
    const queued = new Set<string>()
    const agent: NoticeAgent = {
      status: "running",
      queued: (messageId) => queued.has(messageId),
      unqueue: (messageId) => void queued.delete(messageId),
      recorded: () => false,
      followup: (message) => void queued.add(message.id),
      inject: (message) => void queued.add(message.id),
    }
    const delivery = createNoticeDelivery({
      outbox,
      admit: (_botId, work) => work("main"),
      archived: () => false,
      ready: async () => {},
      resolve: async () => agent,
      hand: (work) => work(),
      later: () => () => {},
      retry: { initialMs: 1, maxMs: 1 },
      warn: () => {},
    })
    await outbox.enqueue(
      "b1",
      "space",
      { text: "a", summary: "a" },
      { space: { spaceId: ID, public: true, events: 2 } },
    )
    await outbox.enqueue("b1", "event", { text: "b", summary: "b" })
    await new Promise((done) => setTimeout(done, 10))
    expect(queued.size).toBe(2)
    const withdrawn = await delivery.withdrawWhere(
      (entry) => entry.space?.spaceId === ID && entry.space.public,
    )
    expect(withdrawn.map((entry) => entry.space)).toEqual([
      { spaceId: ID, public: true, events: 2 },
    ])
    expect(queued.size).toBe(1)
    expect(outbox.pending("b1").map((entry) => entry.topic)).toEqual(["event"])
    expect([...notices.rows.values()].map((record) => record.topic)).toEqual(["event"])
    delivery.dispose()
  })
})
