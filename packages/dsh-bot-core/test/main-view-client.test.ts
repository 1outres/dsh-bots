import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { MainViewClient } from "../src/client/main-view/client"
import { MainTimeline } from "../src/client/main-view/MainTimeline"
import { createTimelineModel, type TimelineFeed } from "../src/client/main-view/model"
import { GROUP_GAP_MS, timelineRows } from "../src/client/main-view/rows"
import { createSessionLogSeats } from "../src/client/main-view/seats"
import {
  applyFrame,
  LOADING_TIMELINE,
  pageFailed,
  pageLoaded,
  pageLoading,
  streamLost,
  type TimelineState,
} from "../src/client/main-view/state"
import { parseMarkdown } from "../src/client/markdown"
import type { StreamHandle } from "../src/client/types"
import type {
  MainBotReply,
  MainMessageAuthor,
  MainPersonMessage,
  MainTimelineFrame,
  MainTimelineItem,
  MainTimelinePage,
} from "../src/shared/main-view"
import { bot, t, value } from "./support/client"

const ALICE: MainMessageAuthor = {
  kind: "channel",
  channel: "Discord",
  place: "DM",
  name: "Alice",
  handle: "alice",
  owner: true,
  bot: false,
}

const person = (
  id: string,
  at: number,
  author: MainMessageAuthor = { kind: "web" },
  seq = at,
): MainPersonMessage => ({
  kind: "person",
  id,
  sessionId: "m",
  seq,
  at,
  author,
  text: `text ${id}`,
  images: [],
  files: [],
})

const reply = (id: string, at: number, seq = at): MainBotReply => ({
  kind: "reply",
  id,
  sessionId: "m",
  seq,
  at,
  text: `**reply** ${id}`,
  interrupted: false,
})

const start = (
  items: MainTimelineItem[],
  earlier?: { sessionId: string; seq: number },
): MainTimelineFrame => ({
  kind: "start",
  mainSessionId: "m",
  items,
  ...(earlier === undefined ? {} : { earlier }),
  replying: false,
})

describe("timeline state", () => {
  it("starts over on a start frame and appends new items on next", () => {
    const first = applyFrame(
      LOADING_TIMELINE,
      start([person("a", 1)], { sessionId: "old", seq: 9 }),
    )
    expect(first).toMatchObject({ status: "ready", earlier: { kind: "more" } })
    const next = applyFrame(first, {
      kind: "next",
      mainSessionId: "new",
      items: [person("a", 1), reply("b", 2)],
      replying: true,
    })
    expect(next).toMatchObject({ mainSessionId: "new", replying: true })
    if (next.status !== "ready") throw new Error("not ready")
    expect(next.items.map((item) => item.id)).toEqual(["a", "b"])
    expect(applyFrame(next, start([reply("c", 3)]))).toMatchObject({
      items: [{ id: "c" }],
      earlier: { kind: "none" },
    })
  })

  it("keeps the items while reconnecting, and fails only without any", () => {
    const ready = applyFrame(LOADING_TIMELINE, { ...start([person("a", 1)]), replying: true })
    expect(streamLost(ready, "gone")).toMatchObject({
      status: "ready",
      reconnecting: true,
      replying: false,
    })
    expect(streamLost(LOADING_TIMELINE, undefined)).toBe(LOADING_TIMELINE)
    expect(streamLost(LOADING_TIMELINE, "gone")).toEqual({ status: "failed", message: "gone" })
  })

  it("prepends an older page for the cursor it was read from, and only that", () => {
    const cursor = { sessionId: "m", seq: 5 }
    let state: TimelineState = applyFrame(LOADING_TIMELINE, start([person("e", 5)], cursor))
    state = pageLoading(state, cursor)
    expect(state).toMatchObject({ earlier: { kind: "loading" } })
    const page: MainTimelinePage = {
      items: [person("d", 4)],
      earlier: { sessionId: "old", seq: 3 },
    }
    expect(pageLoaded(state, { sessionId: "m", seq: 4 }, page)).toBe(state)
    const loaded = pageLoaded(state, cursor, page)
    expect(loaded).toMatchObject({
      items: [{ id: "d" }, { id: "e" }],
      earlier: { kind: "more", cursor: { sessionId: "old" } },
    })
    expect(
      pageFailed(
        pageLoading(loaded, { sessionId: "old", seq: 3 }),
        { sessionId: "old", seq: 3 },
        "x",
      ),
    ).toMatchObject({
      earlier: { kind: "failed", message: "x" },
    })
  })
})

describe("timelineRows", () => {
  const dayOf = (at: number) => (at < 1000 ? "2026-11-25" : "2026-11-26")

  it("groups one speaker's close messages and puts a day line where the day changes", () => {
    const rows = timelineRows(
      [
        person("a", 1),
        person("b", 2),
        person("c", 3, ALICE),
        reply("r1", 4),
        {
          kind: "presented",
          id: "p",
          sessionId: "m",
          seq: 5,
          at: 5,
          files: [{ path: "/w/a.pdf", name: "a.pdf" }],
        },
        person("late", GROUP_GAP_MS + 10),
        reply("r2", GROUP_GAP_MS + 20),
        {
          kind: "turn",
          id: "t",
          sessionId: "m",
          seq: 2001,
          at: 2001,
          outcome: { kind: "stopped", by: "user" },
        },
        reply("r3", GROUP_GAP_MS + 40),
      ],
      dayOf,
    )
    expect(rows.map((row) => row.kind)).toEqual([
      "day",
      "person",
      "person",
      "bot",
      "day",
      "person",
      "bot",
      "turn",
      "bot",
    ])
    expect(rows[1]).toMatchObject({ messages: [{ id: "a" }, { id: "b" }] })
    expect(rows[3]).toMatchObject({ entries: [{ id: "r1" }, { id: "p" }] })
  })
})

function client(
  pages: MainTimelinePage[],
): MainViewClient & { frames: { push(frame: MainTimelineFrame): void } } {
  const queue: MainTimelineFrame[] = []
  let wake: (() => void) | undefined
  const handle: StreamHandle<MainTimelineFrame> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        const frame = queue.shift()
        if (frame !== undefined) {
          yield frame
          continue
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
    dispose() {},
  } as StreamHandle<MainTimelineFrame>
  return {
    generation: value<object | undefined>({}),
    watch: async () => () => handle,
    page: vi.fn(async () => pages.shift() as MainTimelinePage),
    image: async () => ({ mediaType: "image/png", data: "" }),
    frames: {
      push(frame) {
        queue.push(frame)
        wake?.()
      },
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("createTimelineModel", () => {
  it("follows the stream and reads one older page at a time", async () => {
    const remote = client([{ items: [person("old", 1)] }])
    const model = createTimelineModel(remote, "x")
    remote.frames.push(start([person("new", 9)], { sessionId: "m", seq: 9 }))
    await settle()
    await settle()
    expect(model.getSnapshot()).toMatchObject({ status: "ready", earlier: { kind: "more" } })
    model.loadEarlier()
    model.loadEarlier()
    expect(remote.page).toHaveBeenCalledTimes(1)
    await settle()
    expect(model.getSnapshot()).toMatchObject({
      items: [{ id: "old" }, { id: "new" }],
      earlier: { kind: "none" },
    })
    model.loadEarlier()
    expect(remote.page).toHaveBeenCalledTimes(1)
    model.dispose()
  })
})

const feedOf = (state: TimelineState): TimelineFeed => ({ ...value(state), loadEarlier() {} })

const draw = (state: TimelineState) =>
  renderToStaticMarkup(
    createElement(MainTimeline, {
      t,
      bot: bot("x", "m"),
      feed: feedOf(state),
      images: { load: () => new Promise<string>(() => {}), dispose() {} },
      openFile() {},
    }),
  )

describe("MainTimeline", () => {
  it("draws people with their route, the bot's replies as Markdown and the beginning", () => {
    const html = draw(
      applyFrame(LOADING_TIMELINE, {
        ...start([
          {
            ...person("a", 1, ALICE),
            images: [
              { attachmentId: "i", mediaType: "image/png", bytes: 3, width: 480, height: 240 },
            ],
            files: [
              { name: "notes.txt", size: "35 B", path: "/home/bot/workspace/.inbox/x/notes.txt" },
            ],
          },
          person("b", 2 + GROUP_GAP_MS * 2),
          reply("r", 3 + GROUP_GAP_MS * 2),
          {
            kind: "turn",
            id: "t",
            sessionId: "m",
            seq: 9,
            at: 4 + GROUP_GAP_MS * 2,
            outcome: { kind: "failed", message: "boom" },
          },
        ]),
        replying: true,
      }),
    )
    expect(html).toContain('data-dshb-main-view-beginning=""')
    expect(html).toContain(">Alice</span>")
    expect(html).toContain('title="@alice"')
    expect(html).toContain("mainView.owner")
    expect(html).toContain("Discord · DM")
    expect(html).toContain("mainView.you")
    expect(html).toContain("mainView.web")
    expect(html).toContain('style="width:240px;height:120px"')
    expect(html).toContain("notes.txt")
    expect(html).toContain("<strong>reply</strong>")
    expect(html).toContain("mainView.failedTurn(boom)")
    expect(html).toContain("mainView.typing(Bot x)")
  })

  it("says it is loading older messages while there are more, and why they failed", () => {
    const more = applyFrame(LOADING_TIMELINE, start([person("a", 1)], { sessionId: "m", seq: 1 }))
    expect(draw(more)).toContain("mainView.earlier")
    expect(draw(more)).not.toContain("data-dshb-main-view-beginning")
    const failed = pageFailed(
      pageLoading(more, { sessionId: "m", seq: 1 }),
      { sessionId: "m", seq: 1 },
      "gone",
    )
    expect(draw(failed)).toContain("mainView.earlierFailed(gone)")
    expect(draw({ status: "failed", message: "no" })).toContain("mainView.failed(no)")
  })
})

describe("SessionLogSeats", () => {
  it("offers one seat per session and releases only its own", () => {
    const seats = createSessionLogSeats()
    const first = {} as HTMLElement
    const second = {} as HTMLElement
    const releaseFirst = seats.offer("m", first)
    const releaseSecond = seats.offer("m", second)
    releaseFirst()
    expect(seats.getSnapshot().m).toBe(second)
    releaseSecond()
    expect(seats.getSnapshot()).toEqual({})
  })
})

describe("Markdown ordered lists", () => {
  it("keeps the number a list starts at", () => {
    expect(parseMarkdown("3. three\n4. four")).toEqual([
      {
        kind: "list",
        ordered: true,
        start: 3,
        items: [[{ kind: "text", text: "three" }], [{ kind: "text", text: "four" }]],
      },
    ])
    expect(parseMarkdown("1. one")[0]).not.toHaveProperty("start")
  })
})
