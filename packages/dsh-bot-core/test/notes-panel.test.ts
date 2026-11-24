/**
 * The notes screen's Host half (docs/specs/bot-notes.md §12): the botNotes
 * panel's queries, who may read, the status it streams and when it changes.
 */
import { describe, expect, it } from "vitest"
import { createBotNotes } from "../src/host/notes/bot-notes"
import type { NotesPlace } from "../src/host/notes/notebook"
import { createNotesPanel } from "../src/host/notes/panel"
import { createNoteTools, type NoteTool } from "../src/host/notes/tools"
import { idMaker, type MemoryNotesFs, memoryNotesFs } from "./support/notes-fs"

const WORKSPACE = "/home/bot/workspace"
const signal = new AbortController().signal

const fileOf = (id: string) => `${WORKSPACE}/notes/${id}.md`
const id = (n: number) => `0193f2a0-0000-7000-8000-${String(n).padStart(12, "0")}`

function note(fields: {
  title: string
  type?: string
  summary?: string
  aliases?: string
  pinned?: boolean
  body?: string
}) {
  return [
    "---",
    `title: ${fields.title}`,
    `type: ${fields.type ?? "topic"}`,
    ...(fields.aliases === undefined ? [] : [`aliases: ${fields.aliases}`]),
    ...(fields.summary === undefined ? [] : [`summary: ${fields.summary}`]),
    ...(fields.pinned === true ? ["pinned: true"] : []),
    "---",
    fields.body ?? "",
  ].join("\n")
}

function setup() {
  const filesOf = new Map<string, MemoryNotesFs>([
    ["a", memoryNotesFs()],
    ["b", memoryNotesFs()],
  ])
  const sessions = new Map([
    ["main-a", "a"],
    ["web-a", "a"],
    ["main-b", "b"],
  ])
  const attached = new Set(["a", "b"])
  const botNotes = createBotNotes({
    sealed: () => true,
    agent: () => undefined,
    botOf: () => undefined,
    kind: {} as never,
    placeOf: () => undefined,
    tools: createNoteTools({ newId: idMaker() }),
  })
  const placeOf = (botId: string): NotesPlace | undefined => {
    const fs = filesOf.get(botId)
    return fs === undefined || !attached.has(botId) ? undefined : { fs, workspace: WORKSPACE }
  }
  const panel = createNotesPanel({
    botOfSession: (sessionId) => sessions.get(sessionId),
    placeOf,
    notes: botNotes,
    timeZone: () => "Asia/Tokyo",
    today: () => "2026-11-24",
    deadline: () => signal,
  })
  const tools = createNoteTools({ newId: () => id(900) })
  /** A note tool call of the bot's, as the notes row makes it. */
  const botCall = (botId: string, tool: NoteTool, args: unknown) =>
    botNotes.withNotes(botId, (state) =>
      tools.call(state, placeOf(botId) as NotesPlace, tool, args, signal),
    )
  const a = filesOf.get("a") as MemoryNotesFs
  a.put(
    fileOf(id(1)),
    note({
      title: "Owner",
      type: "person",
      summary: "The owner.",
      pinned: true,
      body: `Works at [[${id(2)}|the office]].`,
    }),
  )
  a.put(
    fileOf(id(2)),
    note({
      title: "Shibuya",
      type: "place",
      aliases: "[渋谷]",
      summary: "Where the office is.",
      body: `Lunch on [[${id(3)}]].\nSee [[${id(99)}|old note]].`,
    }),
  )
  a.put(
    fileOf(id(3)),
    note({
      title: "2026-11-02",
      type: "daily",
      body: `Met [[${id(1)}|the owner]] in [[${id(2)}]].`,
    }),
  )
  a.put(fileOf(id(4)), note({ title: "2026-10-24", type: "daily", body: "Shibuya again." }))
  a.put(`${WORKSPACE}/notes/broken.md`, "not a note")
  a.put(fileOf(id(5)), "no frontmatter")
  ;(filesOf.get("b") as MemoryNotesFs).put(
    fileOf(id(7)),
    note({ title: "Secret of b", summary: "b only." }),
  )
  return { panel, botNotes, filesOf, attached, botCall, a }
}

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: { code?: string }) => error.code,
  )

describe("the botNotes panel", () => {
  it("answers only a stored bot's session, with that bot's notes", async () => {
    const { panel } = setup()
    expect(await codeOf(panel.list("w1", undefined))).toBe("bot-note/not-bot-session")
    expect(await codeOf(panel.read("w1", id(1)))).toBe("bot-note/not-bot-session")
    expect(await codeOf(panel.search("w1", { query: "x" }))).toBe("bot-note/not-bot-session")
    expect(await codeOf(panel.month("w1", undefined))).toBe("bot-note/not-bot-session")
    expect(() => panel.botOf("w1")).toThrow("not a session of a bot")
    expect(await codeOf(panel.list("", undefined))).toBe("gateway/bad-request")
    const ofB = await panel.list("main-b", undefined)
    expect(ofB.notes.map((hit) => hit.title)).toEqual(["Secret of b"])
    // Another bot's note id is not found through this bot's session.
    expect(await codeOf(panel.read("main-a", id(7)))).toBe("bot-note/not-found")
    expect(await codeOf(panel.read("main-b", id(1)))).toBe("bot-note/not-found")
  })

  it("lists newest first, filters by type, and leaves files that are not notes out", async () => {
    const { panel } = setup()
    const all = await panel.list("main-a", undefined)
    expect(all.notes.map((hit) => hit.title)).toEqual([
      "2026-10-24",
      "2026-11-02",
      "Shibuya",
      "Owner",
    ])
    expect(all.notes[3]).toEqual({
      id: id(1),
      title: "Owner",
      type: "person",
      aliases: [],
      summary: "The owner.",
      pinned: true,
      lines: [],
    })
    const daily = await panel.list("main-a", { type: "daily" })
    expect(daily.notes.map((hit) => hit.title)).toEqual(["2026-10-24", "2026-11-02"])
    expect(await codeOf(panel.list("main-a", { type: "animal" as never }))).toBe(
      "gateway/bad-request",
    )
  })

  it("searches as note_search: names first, then summaries and lines with links as their words", async () => {
    const { panel, botCall } = setup()
    const found = await panel.search("main-a", { query: "shibuya" })
    expect(found.notes.map((hit) => [hit.title, hit.lines])).toEqual([
      ["Shibuya", []],
      // The link's target is matched by its title, as note_search reads it, and shown by its words.
      ["Owner", ["Works at the office."]],
      ["2026-11-02", ["Met the owner in Shibuya."]],
      ["2026-10-24", ["Shibuya again."]],
    ])
    const tool = await botCall("a", "note_search", { query: "shibuya" })
    expect(
      tool
        .split("\n")
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2, 12)),
    ).toEqual(["Shibuya (p", "Owner (per", "2026-11-02", "2026-10-24", "notes/0193"])
    expect((await panel.search("main-a", { query: "渋谷" })).notes.map((hit) => hit.title)).toEqual(
      ["Shibuya"],
    )
    expect(
      (await panel.search("main-a", { query: "OFFICE" })).notes.map((hit) => hit.title),
    ).toEqual(["Owner", "Shibuya"])
    expect((await panel.search("main-a", { query: "shibuya", type: "daily" })).notes).toHaveLength(
      2,
    )
    expect(await codeOf(panel.search("main-a", { query: "  " }))).toBe("gateway/bad-request")
  })

  it("reads a note with its body as stored, its targets, Links (missing ones too) and Backlinks", async () => {
    const { panel } = setup()
    const shibuya = await panel.read("main-a", id(2))
    expect(shibuya.body).toBe(`Lunch on [[${id(3)}]].\nSee [[${id(99)}|old note]].`)
    expect(shibuya.links).toEqual([
      {
        kind: "note",
        note: expect.objectContaining({ id: id(3), title: "2026-11-02", type: "daily" }),
      },
      { kind: "missing", id: id(99) },
    ])
    expect(shibuya.backlinks).toEqual([
      {
        from: expect.objectContaining({ id: id(1), title: "Owner" }),
        line: `Works at [[${id(2)}|the office]].`,
      },
      {
        from: expect.objectContaining({ id: id(3) }),
        line: `Met [[${id(1)}|the owner]] in [[${id(2)}]].`,
      },
    ])
    expect(Object.keys(shibuya.targets).sort()).toEqual([id(1), id(2), id(3)])
    expect(shibuya.targets[id(99)]).toBeUndefined()
    expect(await codeOf(panel.read("main-a", id(50)))).toBe("bot-note/not-found")
  })

  it("gives the daily notes of a month, today's in the bot's time zone by default", async () => {
    const { panel } = setup()
    expect(await panel.month("main-a", undefined)).toEqual({
      revision: expect.any(Number),
      month: "2026-11",
      today: "2026-11-24",
      timeZone: "Asia/Tokyo",
      days: [{ date: "2026-11-02", id: id(3) }],
    })
    expect((await panel.month("main-a", "2026-10")).days).toEqual([
      { date: "2026-10-24", id: id(4) },
    ])
    expect((await panel.month("main-a", "2026-09")).days).toEqual([])
    expect(await codeOf(panel.month("main-a", "2026-13"))).toBe("gateway/bad-request")
  })

  it("streams the status: ready with counts and invalid files, unavailable with the reason, back again", async () => {
    const { panel, attached } = setup()
    const heard: string[] = []
    panel.subscribe((botId) => heard.push(botId))
    expect(panel.status("a")).toEqual({ state: "loading" })
    const unfollow = panel.follow("a")
    await panel.list("main-a", undefined)
    const ready = panel.status("a")
    expect(ready).toMatchObject({
      state: "ready",
      count: 4,
      pinned: { characters: expect.any(Number), limit: 4000 },
      invalid: [{ file: `notes/${id(5)}.md`, problem: expect.any(String) }],
    })
    expect(heard).toContain("a")
    attached.delete("a")
    expect(await codeOf(panel.list("main-a", undefined))).toBe("bot-note/unavailable")
    expect(panel.status("a")).toEqual({
      state: "unavailable",
      message: "the bot's environment is not available",
    })
    attached.add("a")
    panel.environmentChanged("a")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(panel.status("a").state).toBe("ready")
    unfollow()
    expect(panel.status("a")).toEqual({ state: "loading" })
    panel.dispose()
  })

  it("moves the revision when the bot writes a note or bash changes one", async () => {
    const { panel, botCall, a } = setup()
    const unfollow = panel.follow("a")
    const first = await panel.list("main-a", undefined)
    const revisionOf = () => {
      const status = panel.status("a")
      return status.state === "ready" ? status.revision : undefined
    }
    expect(revisionOf()).toBe(first.revision)
    await botCall("a", "note_write", {
      action: "create",
      title: "Tokyo",
      type: "place",
      summary: "A city.",
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    const afterWrite = revisionOf() as number
    expect(afterWrite).toBeGreaterThan(first.revision)
    expect((await panel.list("main-a", undefined)).notes[0]?.title).toBe("Tokyo")
    // An edit with bash, seen by the next query (or the bot's next step).
    a.put(fileOf(id(4)), note({ title: "2026-10-24", type: "daily", body: "Rained." }))
    const read = await panel.read("main-a", id(4))
    expect(read.body).toBe("Rained.")
    expect(read.revision).toBeGreaterThan(afterWrite)
    // Nothing changed: the revision stays.
    expect((await panel.list("main-a", undefined)).revision).toBe(read.revision)
    unfollow()
  })
})
