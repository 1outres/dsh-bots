/**
 * bot-core's notes (docs/specs/bot-notes.md): the file format, the catalog of
 * links, the note tools against a file system in memory, link suggestions,
 * pinned notes and the notes a message names.
 */
import { describe, expect, it } from "vitest"
import { createBotNotes, PINNED_UNREADABLE } from "../src/host/notes/bot-notes"
import { buildCatalog } from "../src/host/notes/catalog"
import { addedRanges } from "../src/host/notes/diff"
import { uuidv7 } from "../src/host/notes/ids"
import { createInitialNotes } from "../src/host/notes/initial"
import { mentionsIn, nameTable } from "../src/host/notes/matching"
import { type Note, noteIdOf, parseNote, serializeNote } from "../src/host/notes/note"
import { createNotebook } from "../src/host/notes/notebook"
import { createNotesState, createNoteTools, type NoteTool } from "../src/host/notes/tools"
import { idMaker, memoryNotesFs } from "./support/notes-fs"

const signal = new AbortController().signal
const WORKSPACE = "/home/bot/workspace"

function notes() {
  const fs = memoryNotesFs()
  const place = { fs, workspace: WORKSPACE }
  const state = createNotesState(createNotebook())
  const newId = idMaker()
  const tools = createNoteTools({ newId })
  const call = (tool: NoteTool, args: unknown) => tools.call(state, place, tool, args, signal)
  const write = (args: object) => call("note_write", args)
  const fileOf = (title: string) =>
    [...fs.files.entries()].find(
      ([, file]) => parseNote(file.text).ok && file.text.includes(`title: ${title}\n`),
    )
  return { fs, place, state, call, write, fileOf, newId }
}

const note = (fields: Partial<Note> & Pick<Note, "title">): Note => ({
  type: "topic",
  aliases: [],
  summary: "s",
  pinned: false,
  body: "",
  ...fields,
})

describe("note files", () => {
  it("reads back what it writes", () => {
    const cases: Note[] = [
      note({
        title: "田中さん（大学）",
        type: "person",
        aliases: ["田中", "田中太郎"],
        summary: "大学の同期。",
        body: "line\n\n[[0193f2a0-1111-7000-8000-000000000001|10月24日]]",
      }),
      note({
        title: "Key: value",
        aliases: ["a, b", "true", "#tag", "- dash"],
        summary: "'quoted' \"too\"",
        pinned: true,
      }),
      { title: "2026-10-24", type: "daily", aliases: [], pinned: false, body: "" },
    ]
    for (const value of cases) {
      expect(parseNote(serializeNote(value))).toEqual({ ok: true, value })
    }
    expect(serializeNote(cases[0] as Note)).toBe(
      "---\ntitle: 田中さん（大学）\ntype: person\naliases: [田中, 田中太郎]\nsummary: 大学の同期。\n---\nline\n\n[[0193f2a0-1111-7000-8000-000000000001|10月24日]]\n",
    )
  })

  it("reads block lists, quotes and CRLF as a person editing by hand writes them", () => {
    const parsed = parseNote(
      "---\r\ntitle: 'It''s'\r\ntype: thing\r\naliases:\r\n  - one\r\n  - \"two\"\r\nsummary: plain # comment\r\npinned: false\r\n---\r\nbody\r\n",
    )
    expect(parsed).toEqual({
      ok: true,
      value: note({
        title: "It's",
        type: "thing",
        aliases: ["one", "two"],
        summary: "plain",
        body: "body",
      }),
    })
  })

  it("refuses what is not a note", () => {
    const problems = [
      "no frontmatter",
      "---\ntitle: x\n",
      "---\ntitle: x\ntype: topic\nsummary: s\ncolor: red\n---\n",
      "---\ntype: topic\nsummary: s\n---\n",
      "---\ntitle: x\ntype: animal\nsummary: s\n---\n",
      "---\ntitle: x\ntype: topic\n---\n",
      "---\ntitle: a|b\ntype: topic\nsummary: s\n---\n",
      "---\ntitle: 2026-10-24\ntype: topic\nsummary: s\n---\n",
      "---\ntitle: Monday\ntype: daily\n---\n",
      "---\ntitle: x\ntype: topic\nsummary: s\npinned: yes\n---\n",
    ].map((text) => parseNote(text))
    expect(problems.every((result) => !result.ok)).toBe(true)
  })

  it("takes only <UUID>.md files as notes", () => {
    expect(noteIdOf("0193f2a0-1111-7000-8000-000000000001.md")).toBe(
      "0193f2a0-1111-7000-8000-000000000001",
    )
    expect(noteIdOf("todo.md")).toBeUndefined()
    expect(noteIdOf("0193F2A0-1111-7000-8000-000000000001.md")).toBeUndefined()
    expect(noteIdOf("0193f2a0-1111-7000-8000-000000000001.txt")).toBeUndefined()
  })

  it("makes UUIDv7 ids that sort by time", () => {
    const random = new Uint8Array(10).fill(255)
    const early = uuidv7(1_700_000_000_000, random)
    const late = uuidv7(1_700_000_000_001, new Uint8Array(10))
    expect(early).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(early < late).toBe(true)
  })
})

describe("the link catalog", () => {
  it("knows links and backlinks by id, and shows them by title", () => {
    const catalog = buildCatalog(
      new Map([
        ["a", note({ title: "Alice", body: "met [[b|Bob]] and [[c]]" })],
        ["b", note({ title: "Bob", body: "with [[a]]\nagain [[a|her]]" })],
      ]),
    )
    expect(catalog.links("a")).toEqual(["b", "c"])
    expect(catalog.backlinks("a")).toEqual([
      { from: "b", line: "with [[Alice]]", stored: "with [[a]]" },
      { from: "b", line: "again [[Alice|her]]", stored: "again [[a|her]]" },
    ])
    expect(catalog.shown("met [[b|Bob]] and [[c]] or [[c|x]]")).toBe(
      "met [[Bob]] and [[(missing note)]] or [[(missing note)|x]]",
    )
  })
})

describe("addedRanges", () => {
  it("is what a change added, narrowed within a changed line", () => {
    const after = "one\ntwo changed\nnew line\nthree"
    const ranges = addedRanges("one\ntwo\nthree", after)
    expect(ranges.map((range) => after.slice(range.start, range.end))).toEqual([
      " changed",
      "new line",
    ])
    expect(addedRanges("", "all")).toEqual([{ start: 0, end: 3 }])
  })
})

describe("note tools", () => {
  it("creates, reads and links notes by title, and lists backlinks", async () => {
    const h = notes()
    await h.write({ action: "create", title: "渋谷", type: "place", summary: "渋谷駅周辺。" })
    const created = await h.write({
      action: "create",
      title: "田中さん（大学）",
      type: "person",
      aliases: ["田中"],
      summary: "大学の同期。",
      body: "[[渋谷]]の会社に勤めている（[[2026-10-24|10月24日]]に聞いた）。",
    })
    expect(created).toContain("Created 田中さん（大学）.")
    expect(created).toContain("Created daily notes: 2026-10-24.")
    const stored = h.fileOf("田中さん（大学）")?.[1].text ?? ""
    expect(stored).toMatch(/\[\[[0-9a-f-]{36}\]\]の会社/)
    expect(stored).not.toContain("[[渋谷")
    await h.write({
      action: "append",
      note: "2026-11-02",
      text: "[[田中|田中さん]]の結婚式の招待状が届いた",
    })
    expect(await h.call("note_read", { note: "田中" })).toBe(
      [
        "# 田中さん（大学）  (person; aliases: 田中)",
        "大学の同期。",
        "",
        "[[渋谷]]の会社に勤めている（[[2026-10-24|10月24日]]に聞いた）。",
        "",
        "Links:",
        "- 渋谷 (place — 渋谷駅周辺。)",
        "- 2026-10-24 (daily)",
        "Backlinks:",
        '- 2026-11-02 (daily): "[[田中さん（大学）|田中さん]]の結婚式の招待状が届いた"',
      ].join("\n"),
    )
    expect(await h.call("note_read", { note: "2026-10-24" })).toContain(
      '- 田中さん（大学） (person): "[[渋谷]]の会社に勤めている',
    )
  })

  it("keeps titles unique, lets aliases repeat, and refuses a name that does not name one note", async () => {
    const h = notes()
    await h.write({
      action: "create",
      title: "田中さん（大学）",
      type: "person",
      aliases: ["田中"],
      summary: "大学の同期",
    })
    await h.write({
      action: "create",
      title: "田中さん（会社）",
      type: "person",
      aliases: ["田中"],
      summary: "経理部",
    })
    await expect(
      h.write({ action: "create", title: "田中さん（会社）", type: "person", summary: "x" }),
    ).rejects.toThrow("already titled")
    await expect(h.call("note_read", { note: "田中" })).rejects.toThrow(
      '"田中" names several notes: 田中さん（大学） (person — 大学の同期) | 田中さん（会社） (person — 経理部)',
    )
    const files = h.fs.files.size
    const refused = h.write({
      action: "create",
      title: "飲み会",
      type: "thing",
      summary: "s",
      body: "[[田中]]と[[鈴木]]",
    })
    await expect(refused).rejects.toThrow("Not saved: these links do not name exactly one note.")
    await expect(refused).rejects.toThrow("[[鈴木]]: no note has this title or alias")
    expect(h.fs.files.size).toBe(files)
  })

  it("suggests links only in what the write added, folded with NFKC and case, without one-character aliases", async () => {
    const h = notes()
    await h.write({
      action: "create",
      title: "Shibuya",
      type: "place",
      aliases: ["渋"],
      summary: "a district",
    })
    await h.write({
      action: "create",
      title: "大学",
      type: "organization",
      summary: "the university",
    })
    await h.write({
      action: "create",
      title: "Log",
      type: "topic",
      summary: "s",
      body: "大学 was mentioned before.",
    })
    const updated = await h.write({
      action: "update",
      note: "Log",
      edits: [
        {
          old: "before.",
          new: "before. Then ＳＨＩＢＵＹＡ and 渋 on 2026-10-24, 2026年10月25日, 10月26日, 昨日, Shibuyaness.",
        },
      ],
    })
    expect(updated.split("\n")).toEqual([
      "Saved Log.",
      "These words match existing notes. If you meant that note, link it with note_link; if not, leave it.",
      '- L1 "ＳＨＩＢＵＹＡ" → Shibuya (place — a district)',
      '- L2 "2026-10-24" → 2026-10-24 (daily, will be created)',
      '- L3 "2026年10月25日" → 2026-10-25 (daily, will be created)',
    ])
  })

  it("links suggestions until the note is written again", async () => {
    const h = notes()
    await h.write({
      action: "create",
      title: "田中さん（大学）",
      type: "person",
      aliases: ["田中"],
      summary: "大学の同期",
    })
    await h.write({
      action: "create",
      title: "田中さん（会社）",
      type: "person",
      aliases: ["田中"],
      summary: "経理部",
    })
    await h.write({ action: "create", title: "渋谷", type: "place", summary: "s" })
    const written = await h.write({
      action: "create",
      title: "飲み会",
      type: "thing",
      summary: "s",
      body: "渋谷で田中と2026-10-24に会った",
    })
    expect(written).toContain(
      '- L2 "田中" → 田中さん（大学） (person — 大学の同期) | 田中さん（会社） (person — 経理部)',
    )
    await expect(h.call("note_link", { note: "飲み会", apply: "L2" })).rejects.toThrow(
      "matches several notes",
    )
    const linked = await h.call("note_link", {
      note: "飲み会",
      apply: ["L1", { id: "L2", target: "田中さん（会社）" }],
    })
    expect(linked.split("\n")).toEqual([
      'Linked in 飲み会: L1 "渋谷" → 渋谷, L2 "田中" → 田中さん（会社）.',
      "Still suggested (same numbers):",
      '- L3 "2026-10-24" → 2026-10-24 (daily, will be created)',
    ])
    const date = await h.call("note_link", { note: "飲み会", apply: "L3" })
    expect(date).toContain("Created daily notes: 2026-10-24.")
    expect(await h.call("note_read", { note: "飲み会" })).toContain(
      "[[渋谷]]で[[田中さん（会社）|田中]]と[[2026-10-24]]に会った",
    )
    await expect(h.call("note_link", { note: "飲み会", apply: "L1" })).rejects.toThrow(
      "No suggestion L1",
    )

    await h.write({ action: "update", note: "飲み会", body: "渋谷でまた会った" })
    await h.write({ action: "update", note: "渋谷", summary: "changed" })
    const [path, file] = h.fileOf("飲み会") ?? []
    h.fs.put(path as string, `${(file as { text: string }).text}bash edit\n`)
    await expect(h.call("note_link", { note: "飲み会", apply: "L1" })).rejects.toThrow(
      "no longer valid",
    )
  })

  it("refuses a write that takes pinned notes over 4,000 characters, and lets one shrink them", async () => {
    const h = notes()
    await h.write({
      action: "create",
      title: "Owner",
      type: "person",
      summary: "s",
      pinned: true,
      body: "a".repeat(2000),
    })
    const ok = await h.write({
      action: "create",
      title: "Now",
      type: "topic",
      summary: "s",
      pinned: true,
      body: "b".repeat(1900),
    })
    expect(ok).toContain("Pinned notes: 3,9")
    const files = new Map(h.fs.files)
    const refused = h.write({ action: "update", note: "Now", body: "b".repeat(2100) })
    await expect(refused).rejects.toThrow("Not saved: pinned notes would take 4,")
    await expect(refused).rejects.toThrow("- Now (topic): 2,115 (this write)")
    expect(h.fs.files).toEqual(files)
    await expect(
      h.write({
        action: "create",
        title: "Extra",
        type: "topic",
        summary: "s",
        pinned: true,
        body: "c".repeat(200),
      }),
    ).rejects.toThrow("Not saved")
    await h.write({
      action: "create",
      title: "Extra",
      type: "topic",
      summary: "s",
      body: "c".repeat(200),
    })
    await expect(h.write({ action: "update", note: "Extra", pinned: true })).rejects.toThrow(
      "Not saved",
    )
    expect(await h.write({ action: "update", note: "Now", pinned: false })).toContain(
      "Pinned notes: 2,0",
    )
  })

  it("searches titles and aliases first, then summaries and text", async () => {
    const h = notes()
    await h.write({
      action: "create",
      title: "Report",
      type: "matter",
      summary: "the yearly kyoto trip",
    })
    await h.write({
      action: "create",
      title: "京都",
      type: "place",
      aliases: ["Kyoto"],
      summary: "a city",
    })
    await h.write({
      action: "create",
      title: "Plan",
      type: "matter",
      summary: "s",
      body: "first\ngo to KYOTO in May",
    })
    expect(await h.call("note_search", { query: "ｋｙｏｔｏ" })).toBe(
      [
        "- 京都 (place — a city)",
        "- Report (matter — the yearly kyoto trip)",
        "- Plan (matter — s)",
        '  "go to KYOTO in May"',
      ].join("\n"),
    )
    expect(await h.call("note_search", { query: "kyoto", type: "place", limit: 1 })).toBe(
      "- 京都 (place — a city)",
    )
  })

  it("sees edits made to the files another way, and reads a file again only when it changed", async () => {
    const h = notes()
    await h.write({ action: "create", title: "Plan", type: "matter", summary: "s", body: "old" })
    const [path, file] = h.fileOf("Plan") ?? []
    h.fs.put(path as string, (file as { text: string }).text.replace("old", "new"))
    h.fs.put(`${WORKSPACE}/notes/README.md`, "not a note")
    h.fs.put(`${WORKSPACE}/notes/0193f2a0-0000-7000-8000-00000000ffff.md`, "broken")
    h.fs.put(`${WORKSPACE}/notes/0193f2a0-0000-7000-8000-00000000fffe.md`, "x".repeat(300 * 1024))
    expect(await h.call("note_read", { note: "Plan" })).toContain("\nnew\n")
    const reads = h.fs.reads.length
    await h.call("note_read", { note: "Plan" })
    expect(h.fs.reads.length).toBe(reads)
    expect(await h.call("note_search", { query: "zzz" })).toContain(
      "- notes/0193f2a0-0000-7000-8000-00000000ffff.md: the file does not start with",
    )
    expect(await h.call("note_search", { query: "zzz" })).toContain(
      "- notes/0193f2a0-0000-7000-8000-00000000fffe.md: is larger than 256 KiB",
    )
    expect(h.fs.reads.some((path) => path.endsWith("fffe.md"))).toBe(false)
  })
})

describe("mentionsIn", () => {
  it("names the notes a message mentions, all of an ambiguous alias, no daily note, at most ten", () => {
    const catalog = buildCatalog(
      new Map([
        ["1", note({ title: "渋谷", type: "place", summary: "駅" })],
        ["2", note({ title: "田中さん（大学）", aliases: ["田中"] })],
        ["3", note({ title: "田中さん（会社）", aliases: ["田中", "T"] })],
        ["4", { title: "2026-10-24", type: "daily", aliases: [], pinned: false, body: "" } as Note],
      ]),
    )
    const table = nameTable(catalog)
    expect(mentionsIn("明日は渋谷で田中とT、2026-10-24に。しぶや", table)).toEqual([
      { text: "渋谷", ids: ["1"] },
      { text: "田中", ids: ["2", "3"] },
    ])
    const many = buildCatalog(
      new Map(Array.from({ length: 12 }, (_, i) => [String(i), note({ title: `name${i}x` })])),
    )
    expect(
      mentionsIn(Array.from({ length: 12 }, (_, i) => `name${i}x`).join(" "), nameTable(many)),
    ).toHaveLength(10)
  })
})

describe("initial notes", () => {
  it("places the pinned Owner and Now once, keeping a note of that title", async () => {
    const h = notes()
    await h.write({ action: "create", title: "Owner", type: "person", summary: "mine" })
    const marked: string[] = []
    const initial = createInitialNotes({
      placeOf: () => h.place,
      withNotes: (_botId, work) => work(h.state),
      newId: h.newId,
      version: 1,
      placed: () => marked.length > 0,
      async mark(botId) {
        marked.push(botId)
      },
    })
    await initial.ensure("a", signal)
    await initial.ensure("a", signal)
    expect(marked).toEqual(["a"])
    expect(await h.call("note_read", { note: "Owner" })).toContain("mine")
    expect(await h.call("note_read", { note: "Now" })).toContain("# Now  (topic; pinned)")
    expect(h.fs.files.size).toBe(2)
  })
})

describe("the notes of a step", () => {
  it("tells the context that the notes cannot be read instead of failing the step", async () => {
    const memory = memoryNotesFs()
    let broken = true
    const fs = {
      ...memory,
      listDir: (target: object, signal?: AbortSignal) => {
        if (broken) return Promise.reject(new Error("the VM does not answer"))
        return memory.listDir(target, signal)
      },
    }
    memory.put(`${WORKSPACE}/notes/x`, "")
    const notes = createBotNotes({
      sealed: () => true,
      agent: (id) => ({ id, session: { header: {} } }),
      botOf: () => "a",
      kind: {
        isMain: () => true,
        isScheduleRun: () => false,
        isRecorded: () => true,
        reviewed: () => undefined,
        curating: () => false,
        isStartedByMain: () => false,
      },
      placeOf: () => ({ fs, workspace: WORKSPACE }),
      tools: createNoteTools({ newId: idMaker() }),
      shield: async (_botId, text) => text,
    })
    const step = { agentId: "main", messages: [{ fromUser: true, text: "hello" }] }
    expect(await notes.prepare("a", "t", step, signal)).toBeUndefined()
    expect(notes.pinned("a", "t", "main")).toBe(`${PINNED_UNREADABLE}: the VM does not answer`)
    broken = false
    await notes.prepare("a", "t", step, signal)
    expect(notes.pinned("a", "t", "main")).toBe("")
  })
})
