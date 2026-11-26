import { describe, expect, it } from "vitest"
import { messageHeader } from "../src/host/channels/header"
import type { LoggedEvent, SessionLog } from "../src/host/conversations/history"
import { personTextOf } from "../src/host/main-view/origin"
import { createMainView, type MainViewDeps } from "../src/host/main-view/panel"
import { timelineOf } from "../src/host/main-view/timeline"
import type { BotMainRecord } from "../src/host/registry"
import type { MainTimelineFrame, MainTimelineItem } from "../src/shared/main-view"

const ALICE = { id: "1", displayName: "Alice [x]", handle: "ali ce", bot: false }

describe("personTextOf", () => {
  it("reads back the header messageHeader writes", () => {
    const header = messageHeader({
      channel: "Discord",
      place: { kind: "direct" },
      sender: ALICE,
      owner: true,
    })
    expect(personTextOf(`${header}\nhello`)).toEqual({
      author: {
        kind: "channel",
        channel: "Discord",
        place: "DM",
        name: "Alice x",
        handle: "alice",
        owner: true,
        bot: false,
      },
      text: "hello",
      saved: [],
    })
  })

  it("reads a server channel's place as written", () => {
    const header = messageHeader({
      channel: "Discord",
      place: { kind: "channel", channel: "general", server: "Home" },
      sender: ALICE,
      owner: false,
    })
    expect(personTextOf(`${header}\nhi`).author).toMatchObject({
      kind: "channel",
      place: "#general (Home)",
      name: "Alice x",
      owner: false,
    })
  })

  it("splits off the files a channel saved", () => {
    const header = messageHeader({
      channel: "Discord",
      place: { kind: "direct" },
      sender: { ...ALICE, bot: true },
      owner: false,
    })
    const text = `${header}\nsee these\n\nAttached files, saved in your workspace:\n- /home/bot/workspace/inbox/a/report.pdf (1.2 KiB)\n- /home/bot/workspace/inbox/a/b (c).txt (12 B)`
    const read = personTextOf(text)
    expect(read.author).toMatchObject({ owner: false, bot: true })
    expect(read.text).toBe("see these")
    expect(read.saved).toEqual([
      { name: "report.pdf", size: "1.2 KiB", path: "/home/bot/workspace/inbox/a/report.pdf" },
      { name: "b (c).txt", size: "12 B", path: "/home/bot/workspace/inbox/a/b (c).txt" },
    ])
  })

  it("takes a text without a header as the owner's, as written", () => {
    expect(
      personTextOf("[not a header]\nAttached files, saved in your workspace:\n- x (1 B)"),
    ).toEqual({
      author: { kind: "web" },
      text: "[not a header]\nAttached files, saved in your workspace:\n- x (1 B)",
      saved: [],
    })
  })
})

function logBuilder() {
  const events: LoggedEvent[] = []
  let seq = 0
  const push = (type: string, data: unknown, surfaceOp?: string) => {
    seq += 1
    events.push({
      type,
      seq,
      time: 1000 + seq,
      data,
      ...(surfaceOp === undefined ? {} : { surfaceOp }),
    })
    return events.at(-1) as LoggedEvent
  }
  return {
    events,
    log: (): SessionLog => ({ inheritedEventCount: 0, events: [...events] }),
    turnStart: (turn: number) => push("turn/start", { turn }),
    turnEnd: (turn: number, reason: unknown = { kind: "completed" }) =>
      push("turn/end", { turn, reason }),
    user: (id: string, content: unknown[], kind = "user") =>
      push("user/message", { id, role: "user", content, source: { kind } }, "append"),
    context: (id: string) =>
      push(
        "user/message",
        {
          id,
          role: "user",
          content: [{ type: "text", text: "<system-reminder>" }],
          source: { kind: "time-context" },
        },
        "append",
      ),
    assistant: (id: string, content: unknown[], turn = 1) =>
      push("assistant/message", { turn, message: { id, role: "assistant", content } }, "append"),
    result: (callId: string, isError = false) =>
      push(
        "tool/result",
        { message: { role: "tool", toolCallId: callId, isError, content: [] } },
        "append",
      ),
    present: (turn: number, files: unknown[]) => push("deliverables/presented", { turn, files }),
  }
}

const kinds = (items: readonly MainTimelineItem[]) =>
  items.map((item) =>
    item.kind === "reply" || item.kind === "person" ? `${item.kind}:${item.text}` : item.kind,
  )

describe("timelineOf", () => {
  it("keeps people's messages and replies, and leaves out reasoning, tools and context", () => {
    const log = logBuilder()
    log.turnStart(1)
    log.user("u1", [
      { type: "text", text: "hi" },
      {
        type: "image",
        attachment: {
          attachmentId: "img",
          mediaType: "image/png",
          bytes: 9,
          width: 4,
          height: 3,
          name: "a.png",
        },
      },
      { type: "file", attachment: { attachmentId: "f", name: "doc.txt", bytes: 2048 } },
    ])
    log.context("c1")
    log.assistant("a1", [
      { type: "reasoning", text: "think" },
      { type: "tool-call", id: "t1", name: "bash", arguments: "{}" },
    ])
    log.result("t1")
    log.assistant("a2", [{ type: "text", text: "hello **there**" }])
    log.turnEnd(1)
    const { items, fold } = timelineOf("s", log.log())
    expect(kinds(items)).toEqual(["person:hi", "reply:hello **there**"])
    expect(items[0]).toMatchObject({
      author: { kind: "web" },
      images: [
        {
          attachmentId: "img",
          mediaType: "image/png",
          bytes: 9,
          width: 4,
          height: 3,
          name: "a.png",
        },
      ],
      files: [{ name: "doc.txt", size: "2.0 KiB" }],
    })
    expect(fold.running).toBeUndefined()
  })

  it("hides a maintenance turn but not a person's message in it", () => {
    const log = logBuilder()
    log.turnStart(1)
    log.user("m", [{ type: "text", text: "write your notes" }], "bot-main")
    log.user("u", [{ type: "text", text: "still here?" }])
    log.assistant("a", [{ type: "text", text: "noted" }])
    log.turnEnd(1, { kind: "error", error: { message: "boom" } })
    expect(kinds(timelineOf("s", log.log()).items)).toEqual(["person:still here?"])
  })

  it("shows a notice turn's reply without the notice", () => {
    const log = logBuilder()
    log.turnStart(1)
    log.user("n", [{ type: "text", text: "A schedule ran" }], "bot-schedule")
    log.assistant("a", [{ type: "text", text: "Your report is ready." }])
    log.turnEnd(1)
    expect(kinds(timelineOf("s", log.log()).items)).toEqual(["reply:Your report is ready."])
  })

  it("withholds what follows a successful stay_silent, and only that", () => {
    const log = logBuilder()
    log.turnStart(1)
    log.user("n", [{ type: "text", text: "event" }], "bot-connector-event")
    log.assistant("a0", [{ type: "text", text: "before" }])
    log.assistant("a1", [
      { type: "text", text: "Routine direct debit confirmation; nothing to tell." },
      { type: "tool-call", id: "s1", name: "stay_silent", arguments: "{}" },
    ])
    log.result("s1")
    log.assistant("a2", [{ type: "text", text: "after" }])
    log.present(1, [{ path: "/w/x.txt" }])
    log.turnEnd(1)
    log.turnStart(2)
    log.user("u", [{ type: "text", text: "again" }])
    log.assistant("b1", [{ type: "tool-call", id: "s2", name: "stay_silent", arguments: "{}" }])
    log.result("s2", true)
    log.assistant("b2", [{ type: "text", text: "spoken" }])
    log.turnEnd(2)
    expect(kinds(timelineOf("s", log.log()).items)).toEqual([
      "reply:before",
      "person:again",
      "reply:spoken",
    ])
  })

  it("shows the text sent with a failed stay_silent once it fails, in its place", () => {
    const log = logBuilder()
    log.turnStart(1)
    log.user("u", [{ type: "text", text: "go" }])
    log.assistant("a1", [
      { type: "text", text: "kept" },
      { type: "tool-call", id: "s1", name: "stay_silent", arguments: "{}" },
    ])
    log.assistant("a2", [{ type: "text", text: "later" }])
    const pending = timelineOf("s", log.log())
    expect(kinds(pending.items)).toEqual(["person:go"])
    log.result("s1", true)
    log.assistant("a3", [{ type: "text", text: "last" }])
    log.turnEnd(1)
    expect(kinds(timelineOf("s", log.log()).items)).toEqual([
      "person:go",
      "reply:kept",
      "reply:later",
      "reply:last",
    ])
  })

  it("shows the text sent with an unanswered stay_silent before the turn's outcome", () => {
    const log = logBuilder()
    log.turnStart(1)
    log.user("u", [{ type: "text", text: "go" }])
    log.assistant("a1", [
      { type: "text", text: "pending" },
      { type: "tool-call", id: "s1", name: "stay_silent", arguments: "{}" },
    ])
    log.turnEnd(1, { kind: "max-tokens" })
    log.turnStart(2)
    log.user("v", [{ type: "text", text: "again" }])
    log.assistant("b1", [
      { type: "text", text: "cut off" },
      { type: "tool-call", id: "s2", name: "stay_silent", arguments: "{}" },
    ])
    log.turnEnd(2, { kind: "interrupted" })
    expect(kinds(timelineOf("s", log.log()).items)).toEqual([
      "person:go",
      "reply:pending",
      "turn",
      "person:again",
    ])
  })

  it("lists presented files and the turns that failed or stopped", () => {
    const log = logBuilder()
    log.turnStart(1)
    log.user("u", [{ type: "text", text: "go" }])
    log.present(1, [{ path: "/home/bot/workspace/out/report.pdf", description: " The report " }])
    log.turnEnd(1, { kind: "aborted", reason: { kind: "user" } })
    log.turnStart(2)
    log.user("v", [{ type: "text", text: "again" }])
    log.turnEnd(2, { kind: "max-tokens" })
    log.turnStart(3)
    log.user("w", [{ type: "text", text: "third" }])
    log.turnEnd(3, { kind: "interrupted" })
    const { items } = timelineOf("s", log.log())
    expect(items.map((item) => item.kind)).toEqual([
      "person",
      "presented",
      "turn",
      "person",
      "turn",
      "person",
    ])
    expect(items[1]).toMatchObject({
      files: [
        {
          path: "/home/bot/workspace/out/report.pdf",
          name: "report.pdf",
          description: "The report",
        },
      ],
    })
    expect(items[2]).toMatchObject({ outcome: { kind: "stopped", by: "user" } })
    expect(items[4]).toMatchObject({
      outcome: { kind: "failed", message: "The reply stopped at the model's output limit." },
    })
  })

  it("stops at a former Main's end and skips inherited events", () => {
    const log = logBuilder()
    log.user("old", [{ type: "text", text: "inherited" }])
    log.user("u", [{ type: "text", text: "kept" }])
    const end = log.events.at(-1)?.time as number
    log.user("late", [{ type: "text", text: "after the end" }])
    expect(
      kinds(timelineOf("s", { inheritedEventCount: 2, events: log.events }, end).items),
    ).toEqual(["person:kept"])
  })
})

function people(count: number, from = 0) {
  const log = logBuilder()
  for (let index = from; index < from + count; index += 1) {
    log.user(`m${index}`, [{ type: "text", text: `${index}` }])
  }
  return log
}

function viewOf(mains: BotMainRecord[], logs: Map<string, SessionLog>) {
  const listeners = new Set<() => void>()
  const deps: MainViewDeps = {
    mainsOf: (botId) => (botId === "bot" ? mains : undefined),
    read: async (sessionId) => logs.get(sessionId),
    readImage: async () => new Uint8Array([1, 2, 3]),
    encodeBase64: (data) => Buffer.from(data).toString("base64"),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    signal: new AbortController().signal,
  }
  return {
    view: createMainView(deps),
    changed: () => {
      for (const listener of [...listeners]) listener()
    },
  }
}

const texts = (items: readonly MainTimelineItem[]) =>
  items.map((item) => (item.kind === "person" ? item.text : item.kind))

describe("createMainView", () => {
  it("starts with the newest items across Mains and pages back through them", async () => {
    const former = people(30)
    const current = people(20, 30)
    const { view } = viewOf(
      [{ sessionId: "old", endedAt: 99_999 }, { sessionId: "new" }],
      new Map([
        ["old", former.log()],
        ["new", current.log()],
      ]),
    )
    const abort = new AbortController()
    const stream = view.watch("bot", abort.signal)[Symbol.asyncIterator]()
    const start = (await stream.next()).value as MainTimelineFrame
    expect(start.kind).toBe("start")
    expect(texts(start.items)).toEqual(Array.from({ length: 40 }, (_, index) => String(index + 10)))
    if (start.kind !== "start" || start.earlier === undefined) throw new Error("no earlier")
    expect(start.earlier).toEqual({ sessionId: "old", seq: 11 })
    const page = await view.page("bot", start.earlier, abort.signal)
    expect(texts(page.items)).toEqual(Array.from({ length: 10 }, (_, index) => String(index)))
    expect(page.earlier).toBeUndefined()
    abort.abort()
    await stream.next()
  })

  it("streams new items and the reply state, and follows a new Main", async () => {
    const current = logBuilder()
    current.user("u0", [{ type: "text", text: "first" }])
    const mains: BotMainRecord[] = [{ sessionId: "a" }]
    const { view, changed } = viewOf(mains, new Map([["a", current.log()]]))
    const abort = new AbortController()
    const stream = view.watch("bot", abort.signal)[Symbol.asyncIterator]()
    expect(texts(((await stream.next()).value as MainTimelineFrame).items)).toEqual(["first"])

    const next = stream.next()
    view.sessionEvent("a", current.turnStart(1))
    view.sessionEvent("a", current.user("u1", [{ type: "text", text: "second" }]))
    const replying = (await next).value as MainTimelineFrame
    expect(replying).toMatchObject({ kind: "next", replying: true })

    const reply = stream.next()
    view.sessionEvent("a", current.assistant("r", [{ type: "text", text: "ok" }]))
    view.sessionEvent("a", current.turnEnd(1))
    const frames: MainTimelineFrame[] = [(await reply).value as MainTimelineFrame]
    if (frames[0]?.replying === true) frames.push((await stream.next()).value as MainTimelineFrame)
    expect(frames.flatMap((frame) => texts(frame.items))).toEqual(
      texts(replying.items).includes("second") ? ["reply"] : ["second", "reply"],
    )
    expect(frames.at(-1)?.replying).toBe(false)

    mains.splice(0, 1, { sessionId: "a", endedAt: 99_999 }, { sessionId: "b" })
    const rotated = stream.next()
    changed()
    expect((await rotated).value).toMatchObject({ kind: "next", mainSessionId: "b", items: [] })
    abort.abort()
    await stream.next()
  })

  it("reads an image only from a message of the bot's Mains", async () => {
    const log = logBuilder()
    log.user("u", [
      {
        type: "image",
        attachment: { attachmentId: "img", mediaType: "image/png", bytes: 3, width: 1, height: 1 },
      },
    ])
    const { view } = viewOf([{ sessionId: "a" }], new Map([["a", log.log()]]))
    const signal = new AbortController().signal
    expect(await view.image("bot", "a", "img", signal)).toEqual({
      mediaType: "image/png",
      data: "AQID",
    })
    await expect(view.image("bot", "a", "other", signal)).rejects.toThrow("no message")
    await expect(view.image("bot", "elsewhere", "img", signal)).rejects.toThrow("not one of")
    await expect(view.page("bot", { sessionId: "elsewhere", seq: 1 }, signal)).rejects.toThrow(
      "not one of",
    )
  })
})
