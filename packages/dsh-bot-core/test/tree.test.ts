import { describe, expect, it } from "vitest"
import {
  botChildren,
  botSessionRows,
  deriveBotNodes,
  deriveTreeNodes,
  flattenTree,
  rovingKey,
  selectedKey,
  sessionLabel,
  type TreeItem,
  type TreeView,
  treeKeyAction,
} from "../src/client/tree"
import type { SessionListState, SessionSummary, WorkspaceSnapshot } from "../src/client/types"
import type { BotView, PendingBotView } from "../src/shared/bots"

const bot = (id: string, sessionIds: string[] = []): BotView => ({
  id,
  name: id,
  avatar: { kind: "emoji", emoji: "🤖", color: "#6366F1" },
  mainSessionId: `m-${id}`,
  mainStartedAt: 0,
  sessionIds,
  formerMainIds: [],
  timezone: "UTC",
  createdAt: 0,
})

const session = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  displayTitle: id,
  title: id,
  running: false,
  blank: false,
  updatedAt: 0,
  ...extra,
})

const listOf = (...rows: SessionSummary[]): SessionListState => ({
  phase: "ready",
  ids: rows.map((row) => row.id),
  byId: Object.fromEntries(rows.map((row) => [row.id, row])),
})

const selected = { retainedBy: { mainView: 1 } }

const view = (overrides: Partial<TreeView> = {}): TreeView => ({
  expansion: {},
  archivedShown: {},
  windows: {},
  ...overrides,
})

const workspaces = (archivedSessionIds: string[] = []): WorkspaceSnapshot => ({
  phase: "ready",
  items: [],
  archivedSessionIds,
})

const ids = (count: number) => Array.from({ length: count }, (_, index) => `s${index + 1}`)

describe("botSessionRows", () => {
  const a = bot("a", ["s1", "s2", "s3", "s4", "s5"])
  const list = listOf(
    session("m-a"),
    session("s1"),
    session("s2"),
    session("s3", { origin: "subagent" }),
    session("s4", { blank: true }),
    session("s5", { running: true }),
  )

  it("lists the other sessions newest first, without Main, archived, unknown, subagent and unselected blank ones", () => {
    expect(botSessionRows(a, list, workspaces(["s2"]), false)).toEqual([
      { id: "s5", archived: false, selected: false, running: true },
      { id: "s1", archived: false, selected: false, running: false },
    ])
  })

  it("keeps archived sessions in place, grayed and never running, while the bot shows them", () => {
    const rows = botSessionRows(a, list, workspaces(["s2", "s5"]), true)
    expect(rows.map((row) => [row.id, row.archived, row.running])).toEqual([
      ["s5", true, false],
      ["s2", true, false],
      ["s1", false, false],
    ])
  })

  it("keeps a blank session while it is selected", () => {
    const rows = botSessionRows(
      a,
      listOf(session("s1"), session("s4", { blank: true, ...selected })),
      workspaces(),
      false,
    )
    expect(rows.map((row) => [row.id, row.selected])).toEqual([
      ["s4", true],
      ["s1", false],
    ])
  })
})

describe("deriveBotNodes / flattenTree / selectedKey", () => {
  it("lists bots newest first and follows the selection without a saved expansion", () => {
    const list = listOf(session("m-a"), session("a1"), session("m-b"), session("b1", selected))
    const nodes = deriveBotNodes([bot("a", ["a1"]), bot("b", ["b1"])], list, workspaces(), view())
    expect(nodes.map((node) => [node.key, node.expanded])).toEqual([
      ["bot:b", true],
      ["bot:a", false],
    ])
    expect(flattenTree(nodes).map((item) => item.key)).toEqual([
      "bot:b",
      "session:m-b",
      "session:b1",
      "bot:a",
    ])
    expect(selectedKey(nodes)).toBe("session:b1")
  })

  it("selects the bot row while its sessions are hidden", () => {
    const list = listOf(session("m-a", selected), session("a1"))
    const nodes = deriveBotNodes(
      [bot("a", ["a1"])],
      list,
      workspaces(),
      view({ expansion: { a: false } }),
    )
    expect(flattenTree(nodes).map((item) => item.key)).toEqual(["bot:a"])
    expect(selectedKey(nodes)).toBe("bot:a")
  })

  it("selects Main when expanded and reports running bots", () => {
    const list = listOf(session("m-a", selected), session("a1", { running: true }))
    const nodes = deriveBotNodes(
      [bot("a", ["a1"])],
      list,
      workspaces(),
      view({ expansion: { a: true } }),
    )
    expect(selectedKey(nodes)).toBe("session:m-a")
    expect(nodes[0]?.running).toBe(true)
  })

  it("tells archived rows apart: they activate nothing but say why", () => {
    const list = listOf(session("m-a"), session("a1"), session("a2"))
    const nodes = deriveBotNodes(
      [bot("a", ["a1", "a2"])],
      list,
      workspaces(["a1"]),
      view({ expansion: { a: true }, archivedShown: { a: true } }),
    )
    expect(flattenTree(nodes).map((item) => item.activates)).toEqual([
      { kind: "session", sessionId: "m-a" },
      { kind: "session", sessionId: "m-a" },
      { kind: "session", sessionId: "a2" },
      { kind: "archived", sessionId: "a1" },
    ])
  })
})

describe("the window over a bot's sessions", () => {
  const many = bot("a", ids(12))
  const listed = (extra: Record<string, Partial<SessionSummary>> = {}) =>
    listOf(session("m-a"), ...ids(12).map((id) => session(id, extra[id])))

  it("shows the five newest, then a Show more row naming the rest, at the bottom", () => {
    const [node] = deriveBotNodes([many], listed(), workspaces(), view({ expansion: { a: true } }))
    expect(node?.sessions.map((row) => row.id)).toEqual(["s12", "s11", "s10", "s9", "s8"])
    expect(node?.overflow).toEqual({ kind: "more", hidden: 7 })
    const items = flattenTree(node === undefined ? [] : [node])
    expect(items.at(-1)).toEqual({
      key: "overflow:a",
      level: 2,
      botId: "a",
      parentKey: "bot:a",
      activates: { kind: "overflow", botId: "a", overflow: { kind: "more", hidden: 7 }, window: 5 },
    })
  })

  it("follows the stored window and offers Show less once everything is listed", () => {
    const wider = deriveBotNodes([many], listed(), workspaces(), view({ windows: { a: 10 } }))[0]
    expect(wider?.sessions).toHaveLength(10)
    expect(wider?.overflow).toEqual({ kind: "more", hidden: 2 })
    const all = deriveBotNodes(
      [many],
      listed(),
      workspaces(),
      view({ windows: { a: Number.POSITIVE_INFINITY } }),
    )[0]
    expect(all?.sessions).toHaveLength(12)
    expect(all?.overflow).toEqual({ kind: "less" })
  })

  it("has no overflow row while the bot has five sessions or fewer", () => {
    const few = bot("a", ids(5))
    const [node] = deriveBotNodes(
      [few],
      listOf(session("m-a"), ...ids(5).map((id) => session(id))),
      workspaces(),
      view(),
    )
    expect(node?.sessions).toHaveLength(5)
    expect(node?.overflow).toBeUndefined()
  })

  it("reveals a selected session wherever it is, opening the bot", () => {
    const [node] = deriveBotNodes([many], listed({ s1: selected }), workspaces(), view())
    expect(node?.expanded).toBe(true)
    expect(node?.sessions).toHaveLength(12)
    expect(node?.overflow).toBeUndefined()
    expect(node === undefined ? undefined : selectedKey([node])).toBe("session:s1")
  })

  it("counts archived sessions in the window while they are shown", () => {
    const [node] = deriveBotNodes(
      [many],
      listed(),
      workspaces(["s12", "s11"]),
      view({ archivedShown: { a: true } }),
    )
    expect(node?.sessions.map((row) => [row.id, row.archived])).toEqual([
      ["s12", true],
      ["s11", true],
      ["s10", false],
      ["s9", false],
      ["s8", false],
    ])
    expect(node?.overflow).toEqual({ kind: "more", hidden: 7 })
  })
})

describe("deriveTreeNodes", () => {
  const pending = (id: string, createdAt: number, kind: "create" | "remove"): PendingBotView => ({
    id,
    name: id,
    avatar: { kind: "emoji", emoji: "🤖", color: "#6366F1" },
    operation: kind === "create" ? { kind, phase: "queued" } : { kind },
    startedAt: 0,
    sessionIds: [],
    createdAt,
  })

  it("puts pending bots among the listed ones by creation, newest first, opening their progress", () => {
    const listed = [
      { ...bot("a"), createdAt: 1 },
      { ...bot("c"), createdAt: 3 },
    ]
    const nodes = deriveTreeNodes(
      listed,
      [pending("b", 2, "remove"), pending("d", 4, "create")],
      listOf(session("m-a", selected)),
      workspaces(),
      view(),
      null,
    )
    expect(nodes.map((node) => node.key)).toEqual(["pending:d", "bot:c", "pending:b", "bot:a"])
    const items = flattenTree(nodes)
    expect(items.map((item) => item.activates)).toEqual([
      { kind: "progress", botId: "d" },
      { kind: "session", sessionId: "m-c" },
      { kind: "none" },
      { kind: "session", sessionId: "m-a" },
    ])
    expect(selectedKey(nodes)).toBe("bot:a")
  })

  it("selects the pending row whose progress shows, and no session meanwhile", () => {
    const list = listOf(session("m-a", selected), session("a1", selected))
    const nodes = deriveTreeNodes(
      [bot("a", ["a1"])],
      [pending("d", 4, "create")],
      list,
      workspaces(),
      view({ expansion: { a: true } }),
      "d",
    )
    expect(nodes[0]).toMatchObject({ kind: "pending", selected: true })
    expect(nodes[1]).toMatchObject({ kind: "bot", mainSelected: false, childSelected: false })
    expect(nodes[1]?.kind === "bot" && nodes[1].sessions[0]?.selected).toBe(false)
    expect(selectedKey(nodes)).toBe("pending:d")
    expect(treeKeyAction(flattenTree(nodes), "pending:d", "Enter")).toMatchObject({
      kind: "activate",
    })
    expect(treeKeyAction(flattenTree(nodes), "pending:d", "ArrowRight")).toBeUndefined()
  })
})

describe("rovingKey", () => {
  const items: TreeItem[] = [
    {
      key: "bot:a",
      level: 1,
      botId: "a",
      activates: { kind: "session", sessionId: "m-a" },
      expanded: false,
    },
    {
      key: "bot:b",
      level: 1,
      botId: "b",
      activates: { kind: "session", sessionId: "m-b" },
      expanded: false,
    },
  ]
  it("prefers the focused row, then the selected row, then the first row", () => {
    expect(rovingKey(items, "bot:b", "bot:a")).toBe("bot:b")
    expect(rovingKey(items, "session:gone", "bot:b")).toBe("bot:b")
    expect(rovingKey(items, undefined, undefined)).toBe("bot:a")
    expect(rovingKey([], undefined, undefined)).toBeUndefined()
  })
})

describe("treeKeyAction", () => {
  const a: TreeItem = {
    key: "bot:a",
    level: 1,
    botId: "a",
    activates: { kind: "session", sessionId: "m-a" },
    expanded: true,
  }
  const main: TreeItem = {
    key: "session:m-a",
    level: 2,
    botId: "a",
    activates: { kind: "session", sessionId: "m-a" },
    parentKey: "bot:a",
  }
  const a1: TreeItem = {
    key: "session:a1",
    level: 2,
    botId: "a",
    activates: { kind: "session", sessionId: "a1" },
    parentKey: "bot:a",
  }
  const more: TreeItem = {
    key: "overflow:a",
    level: 2,
    botId: "a",
    activates: { kind: "overflow", botId: "a", overflow: { kind: "more", hidden: 3 }, window: 5 },
    parentKey: "bot:a",
  }
  const b: TreeItem = {
    key: "bot:b",
    level: 1,
    botId: "b",
    activates: { kind: "session", sessionId: "m-b" },
    expanded: false,
  }
  const items = [a, main, a1, more, b]

  it("moves with the arrow keys, Home and End", () => {
    expect(treeKeyAction(items, "bot:a", "ArrowDown")).toEqual({
      kind: "focus",
      key: "session:m-a",
    })
    expect(treeKeyAction(items, "session:a1", "ArrowUp")).toEqual({
      kind: "focus",
      key: "session:m-a",
    })
    expect(treeKeyAction(items, "session:a1", "ArrowDown")).toEqual({
      kind: "focus",
      key: "overflow:a",
    })
    expect(treeKeyAction(items, "bot:b", "ArrowDown")).toBeUndefined()
    expect(treeKeyAction(items, "bot:a", "ArrowUp")).toBeUndefined()
    expect(treeKeyAction(items, "session:a1", "Home")).toEqual({ kind: "focus", key: "bot:a" })
    expect(treeKeyAction(items, "bot:a", "End")).toEqual({ kind: "focus", key: "bot:b" })
    expect(treeKeyAction(items, "bot:b", "End")).toBeUndefined()
  })

  it("expands a collapsed bot and enters an expanded one", () => {
    expect(treeKeyAction(items, "bot:b", "ArrowRight")).toEqual({ kind: "expand", item: b })
    expect(treeKeyAction(items, "bot:a", "ArrowRight")).toEqual({
      kind: "focus",
      key: "session:m-a",
    })
    expect(treeKeyAction(items, "session:a1", "ArrowRight")).toBeUndefined()
  })

  it("collapses an expanded bot and returns from a session or the overflow row to its bot", () => {
    expect(treeKeyAction(items, "bot:a", "ArrowLeft")).toEqual({ kind: "collapse", item: a })
    expect(treeKeyAction(items, "bot:b", "ArrowLeft")).toBeUndefined()
    expect(treeKeyAction(items, "session:a1", "ArrowLeft")).toEqual({ kind: "focus", key: "bot:a" })
    expect(treeKeyAction(items, "overflow:a", "ArrowLeft")).toEqual({ kind: "focus", key: "bot:a" })
  })

  it("activates with Enter and Space and ignores other keys or unknown rows", () => {
    expect(treeKeyAction(items, "session:a1", "Enter")).toEqual({ kind: "activate", item: a1 })
    expect(treeKeyAction(items, "overflow:a", " ")).toEqual({ kind: "activate", item: more })
    expect(treeKeyAction(items, "bot:b", " ")).toEqual({ kind: "activate", item: b })
    expect(treeKeyAction(items, "bot:b", "a")).toBeUndefined()
    expect(treeKeyAction(items, "bot:zz", "ArrowDown")).toBeUndefined()
  })
})

describe("sessionLabel", () => {
  const b = bot("b", ["s1", "s2", "s3"])

  it("uses DSH's title once it has one", () => {
    expect(sessionLabel(b, "s2", session("s2", { title: "Plans" }))).toEqual({
      kind: "titled",
      title: "Plans",
    })
  })

  it("numbers an untitled session by creation order among the bot's other sessions, whatever the listing order", () => {
    const { title: _title, ...untitled } = session("s1")
    expect(sessionLabel(b, "s1", untitled)).toEqual({ kind: "untitled", ordinal: 1 })
    expect(sessionLabel(b, "s3", session("s3", { title: "" }))).toEqual({
      kind: "untitled",
      ordinal: 3,
    })
    expect(sessionLabel(b, "s2", undefined)).toEqual({ kind: "untitled", ordinal: 2 })
  })
})

describe("former Mains", () => {
  const withPast: BotView = { ...bot("a", ["s1", "p1", "p2"]), formerMainIds: ["p1", "p2"] }
  const list = listOf(
    session("m-a"),
    session("s1"),
    session("p1", { title: "a" }),
    session("p2", { title: "a" }),
  )
  const snapshot = workspaces(["p1", "p2"])

  it("are archived sessions like any other: hidden until the bot shows archived ones, then newest first", () => {
    const [hidden] = deriveBotNodes([withPast], list, snapshot, view({ expansion: { a: true } }))
    if (hidden === undefined) throw new Error("no node")
    expect(botChildren(hidden).map((item) => item.key)).toEqual(["session:m-a", "session:s1"])
    const [shown] = deriveBotNodes(
      [withPast],
      list,
      snapshot,
      view({ expansion: { a: true }, archivedShown: { a: true } }),
    )
    if (shown === undefined) throw new Error("no node")
    expect(botChildren(shown).map((item) => item.key)).toEqual([
      "session:m-a",
      "session:p2",
      "session:p1",
      "session:s1",
    ])
    expect(shown.sessions.filter((row) => row.archived).map((row) => row.id)).toEqual(["p2", "p1"])
  })

  it("are named by their title, as other sessions", () => {
    expect(sessionLabel(withPast, "p1", list.byId.p1)).toEqual({ kind: "titled", title: "a" })
  })
})
