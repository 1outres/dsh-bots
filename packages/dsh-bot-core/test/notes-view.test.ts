import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { parseInline, parseMarkdown } from "../src/client/markdown"
import { monthGrid, shiftMonth } from "../src/client/notes/calendar"
import type { NotesClient } from "../src/client/notes/client"
import { NoteRequestError } from "../src/client/notes/client"
import { createNotesModel } from "../src/client/notes/model"
import { NotesContent } from "../src/client/notes/NotesPanel"
import type { FeedState } from "../src/client/remote-feed"
import type {
  BotNotesStatus,
  NoteDocument,
  NoteEntry,
  NoteListing,
  NoteMonth,
} from "../src/shared/notes"
import { t, value } from "./support/client"
import { manualTimers } from "./support/notes"

const entry = (id: string, title: string, fields: Partial<NoteEntry> = {}): NoteEntry => ({
  id,
  title,
  type: "topic",
  aliases: [],
  summary: `About ${title}`,
  pinned: false,
  ...fields,
})

const OWNER = entry("n1", "Owner", { type: "person", pinned: true })
const SHIBUYA = entry("n2", "Shibuya", { type: "place", aliases: ["渋谷"] })
const DAY = entry("n3", "2026-11-02", { type: "daily", summary: undefined })

const READY = (revision: number): FeedState<BotNotesStatus> => ({
  status: "ready",
  value: {
    state: "ready",
    revision,
    count: 3,
    pinned: { characters: 120, limit: 4000 },
    invalid: [],
  },
})

const SHIBUYA_DOCUMENT: NoteDocument = {
  revision: 1,
  note: SHIBUYA,
  body: "# Area\n\nLunch on [[n3]] with [[n1|the owner]].\nSee [[n9|an old note]] and [[n8]].",
  targets: { n1: OWNER, n2: SHIBUYA, n3: DAY },
  links: [
    { kind: "note", note: DAY },
    { kind: "note", note: OWNER },
    { kind: "missing", id: "n9" },
    { kind: "missing", id: "n8" },
  ],
  backlinks: [{ from: DAY, line: "Met [[n1|her]] in [[n2]]." }],
}

function fakeClient(status = value<FeedState<BotNotesStatus>>(READY(1))) {
  const calls: string[] = []
  let revision = 1
  const client: NotesClient = {
    status: () => status,
    async list(_sessionId, filter) {
      calls.push(`list ${filter.type ?? "all"}`)
      const notes = [DAY, SHIBUYA, OWNER].filter(
        (note) => filter.type === undefined || note.type === filter.type,
      )
      return {
        revision,
        notes: notes.map((note) => ({ ...note, lines: [] })),
      } satisfies NoteListing
    },
    async search(_sessionId, search) {
      calls.push(`search ${search.query}`)
      return {
        revision,
        notes: [
          { ...SHIBUYA, lines: [] },
          { ...DAY, lines: ["Met her in Shibuya."] },
        ],
      }
    },
    async read(_sessionId, noteId) {
      calls.push(`read ${noteId}`)
      if (noteId !== "n2")
        throw new NoteRequestError({ kind: "host", code: "bot-note/not-found", message: "gone" })
      return { ...SHIBUYA_DOCUMENT, revision }
    },
    async month(_sessionId, month) {
      calls.push(`month ${month ?? "today"}`)
      return {
        revision,
        month: month ?? "2026-11",
        today: "2026-11-24",
        timeZone: "Asia/Tokyo",
        days: (month ?? "2026-11") === "2026-11" ? [{ date: "2026-11-02", id: "n3" }] : [],
      } satisfies NoteMonth
    },
  }
  return {
    client,
    calls,
    status,
    bump(next: number) {
      revision = next
      status.set(READY(next))
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function screen() {
  const fake = fakeClient()
  const timers = manualTimers()
  const model = createNotesModel(fake.client, "m", timers)
  const detach = model.attach()
  const html = () => renderToStaticMarkup(createElement(NotesContent, { t, model }))
  return { ...fake, timers, model, detach, html }
}

describe("note links in Markdown", () => {
  it("reads [[id]] and [[id|text]] only when asked, as the Host's links", () => {
    expect(parseInline("a [[n1]] b [[n2|two]] c", { noteLinks: true })).toEqual([
      { kind: "text", text: "a " },
      { kind: "note", target: "n1" },
      { kind: "text", text: " b " },
      { kind: "note", target: "n2", text: "two" },
      { kind: "text", text: " c" },
    ])
    expect(parseInline("a [[n1]]")).toEqual([{ kind: "text", text: "a [[n1]]" }])
    expect(parseInline("[[a|b|c]] [[]] [[x\ny]]", { noteLinks: true })).toEqual([
      { kind: "note", target: "a", text: "b|c" },
      { kind: "text", text: " [[]] [[x\ny]]" },
    ])
    expect(parseMarkdown("- **[[n1]]**", { noteLinks: true })).toEqual([
      {
        kind: "list",
        ordered: false,
        items: [[{ kind: "strong", children: [{ kind: "note", target: "n1" }] }]],
      },
    ])
  })
})

describe("the notes calendar grid", () => {
  it("lays a month out in weeks from Sunday", () => {
    const november = monthGrid("2026-11")
    expect(november[0]).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
    ])
    expect(november.at(-1)).toEqual(["2026-11-29", "2026-11-30", null, null, null, null, null])
    expect(
      monthGrid("2024-02")
        .flat()
        .filter((day) => day !== null),
    ).toHaveLength(29)
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
  })
})

describe("the notes screen", () => {
  it("lists the pinned notes apart, then the rest, by title, type and summary", async () => {
    const { html, calls, detach } = screen()
    await settle()
    expect(calls).toEqual(["list all"])
    const out = html()
    expect(out).toContain('data-dshb-notes-pinned=""')
    expect(out).toContain("notes.pinned.usage(120,4,000)")
    expect(out).toMatch(
      /data-dshb-notes-pinned[\s\S]*Owner[\s\S]*data-dshb-notes-all[\s\S]*2026-11-02[\s\S]*Shibuya/,
    )
    expect(out).toContain("About Shibuya")
    expect(out).toContain('data-dshb-note-type="place"')
    expect(out).not.toContain("n2</")
    detach()
  })

  it("searches after the typing pauses, and filters by type", async () => {
    const { html, calls, model, timers, detach } = screen()
    await settle()
    model.setQuery("shibuya")
    await settle()
    expect(calls).toEqual(["list all"])
    timers.run()
    await settle()
    expect(calls).toEqual(["list all", "search shibuya"])
    const out = html()
    expect(out).toContain('data-dshb-notes-results=""')
    expect(out).toContain("notes.results.other(2)")
    expect(out).toContain("Met her in Shibuya.")
    expect(out).not.toContain("data-dshb-notes-pinned")
    model.setQuery("")
    model.setType("daily")
    await settle()
    expect(calls.at(-1)).toBe("list daily")
    expect(html()).toContain("notes.results.one(1)")
    detach()
  })

  it("shows the daily notes of the month, marks today and opens a day's note", async () => {
    const { html, calls, model, detach } = screen()
    model.setTab("calendar")
    await settle()
    expect(calls.at(-1)).toBe("month today")
    const out = html()
    expect(out).toContain('data-dshb-notes-calendar="2026-11"')
    expect(out).toContain('data-dshb-notes-day="2026-11-02"')
    expect(out).toMatch(/data-today=""[^>]*>24</)
    expect(out).toContain("November 2026")
    model.showMonth("2026-10")
    await settle()
    expect(calls.at(-1)).toBe("month 2026-10")
    expect(html()).not.toContain("data-dshb-notes-day=")
    detach()
  })

  it("opens a note: body with links by title, missing links marked, Links and Backlinks, and Back", async () => {
    const { html, model, calls, detach } = screen()
    model.open("n2")
    await settle()
    expect(calls.at(-1)).toBe("read n2")
    const out = html()
    expect(out).toContain("<h1>Area</h1>")
    expect(out).toMatch(/data-dshb-note-link="n3"[^>]*>2026-11-02</)
    expect(out).toMatch(/data-dshb-note-link="n1"[^>]*>the owner</)
    expect(out).toMatch(/data-missing=""[^>]*>an old note</)
    expect(out).toMatch(/data-missing=""[^>]*>notes.missing</)
    expect(out).toContain("notes.aliases(渋谷)")
    expect(out).toContain('data-dshb-note-missing="n9"')
    expect(out).toMatch(
      /data-dshb-note-backlinks[\s\S]*2026-11-02[\s\S]*Met [\s\S]*>her<[\s\S]*>Shibuya</,
    )
    expect(out).not.toContain("n1|")
    model.open("n3")
    await settle()
    expect(html()).toContain("notes.error.not-found")
    model.back()
    await settle()
    expect(model.navigation.getSnapshot().trail).toEqual(["n2"])
    model.back()
    expect(model.navigation.getSnapshot().trail).toEqual([])
    detach()
  })

  it("reads again what it shows when the notes change, and only then", async () => {
    const { calls, model, bump, detach } = screen()
    model.open("n2")
    await settle()
    expect(calls.filter((call) => call === "read n2")).toHaveLength(1)
    bump(1)
    await settle()
    expect(calls.filter((call) => call === "read n2")).toHaveLength(1)
    bump(2)
    await settle()
    expect(calls.filter((call) => call === "read n2")).toHaveLength(2)
    expect(model.document.getSnapshot()).toMatchObject({ status: "ready", value: { revision: 2 } })
    model.refresh()
    await settle()
    expect(calls.filter((call) => call === "read n2")).toHaveLength(3)
    detach()
  })

  it("shows why the notes cannot be read, and nothing else; an empty notebook says so", () => {
    const unavailable = value<FeedState<BotNotesStatus>>({
      status: "ready",
      value: { state: "unavailable", message: "the bot's environment is not available" },
    })
    const fake = fakeClient(unavailable)
    const model = createNotesModel(fake.client, "m", manualTimers())
    model.attach()
    const out = renderToStaticMarkup(createElement(NotesContent, { t, model }))
    expect(out).toContain("notes.unavailable")
    expect(out).toContain("the bot&#x27;s environment is not available")
    expect(out).not.toContain("data-dshb-notes-tab")
    expect(fake.calls).toEqual([])
    model.refresh()
    expect(fake.calls).toEqual(["list all"])
    unavailable.set({
      status: "ready",
      value: {
        state: "ready",
        revision: 1,
        count: 0,
        pinned: { characters: 0, limit: 4000 },
        invalid: [],
      },
    })
    expect(renderToStaticMarkup(createElement(NotesContent, { t, model }))).toContain(
      'data-dshb-notes-empty=""',
    )
  })
})
