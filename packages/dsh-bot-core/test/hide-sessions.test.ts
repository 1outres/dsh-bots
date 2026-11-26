import { describe, expect, it } from "vitest"
import { botSessionsCss, hasOtherUngrouped, type SessionViews } from "../src/client/hide-sessions"
import type { BotsState } from "../src/client/session-classification"
import type { SessionSummary } from "../src/client/types"
import type { BotView } from "../src/shared/bots"
import { creating } from "./support/client"

const bot = (id: string, mainSessionId: string, sessionIds: string[] = []): BotView => ({
  id,
  name: id,
  avatar: { kind: "emoji", emoji: "🤖", color: "#6366F1" },
  mainSessionId,
  mainStartedAt: 0,
  timezone: "UTC",
  sessionIds,
  formerMainIds: [],
  createdAt: 0,
})

const summary = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  displayTitle: id,
  running: false,
  blank: false,
  updatedAt: 0,
  ...extra,
})

const views = (
  sessions: SessionSummary[],
  workspaces: { workspaceId: string; sessionIds: string[] }[] = [],
  archivedSessionIds: string[] = [],
): SessionViews => ({
  list: {
    phase: "ready",
    ids: sessions.map((session) => session.id),
    byId: Object.fromEntries(sessions.map((session) => [session.id, session])),
  },
  workspaces: {
    phase: "ready",
    items: workspaces.map((workspace) => ({
      ...workspace,
      path: `/w/${workspace.workspaceId}`,
    })),
    archivedSessionIds,
  },
})

const listedCss = (
  bots: BotView[],
  creatingIds: string[] = [],
  shown = views([summary("other")]),
) =>
  botSessionsCss(
    {
      status: "ready",
      snapshot: { bots, pending: [creating("c", creatingIds)], preparingSessionIds: [] },
    },
    shown,
  )

describe("botSessionsCss over a delivered list", () => {
  it("is empty without bots", () => {
    expect(listedCss([])).toBe("")
  })

  it("hides each bot's Main and session rows, and nothing else", () => {
    const css = listedCss([bot("a", "m1", ["s1"])])
    expect(css).toContain('[data-sidebar-scrollport] [data-row-key="session:s1"]')
    expect(css).toContain('[data-row-key="session:m1"]')
    expect(css).not.toContain("workspace:")
    expect(css).not.toContain("session:s2")
  })

  it("hides the sessions of a bot being created, before it is listed", () => {
    const css = listedCss([], ["m-new"])
    expect(css).toContain('[data-row-key="session:m-new"]')
  })

  describe("the Ungrouped heading", () => {
    const HEADING = '[data-sidebar-scrollport] [data-row-key="workspace:"]'
    const OVERFLOW = '[data-sidebar-scrollport] [data-row-key="overflow:"]'
    it("is hidden with its overflow button when only bot sessions are ungrouped", () => {
      const css = listedCss(
        [bot("a", "m1", ["s1"])],
        [],
        views(
          [summary("m1"), summary("s1"), summary("w1")],
          [{ workspaceId: "ws", sessionIds: ["w1"] }],
        ),
      )
      expect(css).toContain(`${HEADING}, ${OVERFLOW} { display: none !important; }`)
      expect(css).not.toMatch(/\[class|\.[a-z_]+[A-Za-z0-9_-]*\s*\{/)
    })

    it("stays while another session is ungrouped", () => {
      const css = listedCss([bot("a", "m1")], [], views([summary("m1"), summary("x1")]))
      expect(css).not.toContain(HEADING)
      expect(css).not.toContain(OVERFLOW)
    })

    it("is hidden when the other ungrouped sessions are all archived (DSH's default view hides them)", () => {
      const css = listedCss(
        [bot("a", "m1")],
        [],
        views([summary("m1"), summary("old1"), summary("old2")], [], ["old1", "old2"]),
      )
      expect(css).toContain(`${HEADING}, ${OVERFLOW} { display: none !important; }`)
      expect(
        hasOtherUngrouped(views([summary("old1"), summary("x1")], [], ["old1"]), new Set(["m1"])),
      ).toBe(true)
    })

    it("ignores subagents and blank sessions that are not current, as DSH does", () => {
      const hidden = new Set(["m1"])
      expect(hasOtherUngrouped(views([summary("c1", { origin: "subagent" })]), hidden)).toBe(false)
      expect(hasOtherUngrouped(views([summary("b1", { blank: true })]), hidden)).toBe(false)
      expect(
        hasOtherUngrouped(
          views([summary("b1", { blank: true, retainedBy: { mainView: 1 } })]),
          hidden,
        ),
      ).toBe(true)
      expect(
        hasOtherUngrouped(
          views([summary("w1")], [{ workspaceId: "ws", sessionIds: ["w1"] }]),
          hidden,
        ),
      ).toBe(false)
    })

    it("is left alone without bot sessions", () => {
      expect(listedCss([], [], views([]))).toBe("")
    })
  })
})

describe("botSessionsCss", () => {
  const views: SessionViews = {
    list: { phase: "ready", ids: [], byId: {} },
    workspaces: { phase: "ready", items: [], archivedSessionIds: [] },
  }
  const snapshot = {
    bots: [bot("a", "m1", ["s1"])],
    pending: [creating("c", ["c1"])],
    preparingSessionIds: [],
  }

  it.each([
    ["ready", { status: "ready", snapshot }],
    ["reconnecting", { status: "reconnecting", snapshot }],
  ] as const)("hides the listed and creating sessions while %s", (_status, state: BotsState) => {
    const css = botSessionsCss(state, views)
    for (const id of ["m1", "s1", "c1"]) expect(css).toContain(`[data-row-key="session:${id}"]`)
    expect(css).toContain('[data-row-key="workspace:"]')
  })

  it.each([
    { status: "loading" },
    { status: "unavailable" },
    { status: "failed", error: "x" },
  ] as const)("hides nothing without a list ($status)", (state: BotsState) => {
    expect(botSessionsCss(state, views)).toBe("")
  })
})
