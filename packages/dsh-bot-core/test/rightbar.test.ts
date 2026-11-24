import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, expectTypeOf, it, vi } from "vitest"
import type { SidebarStoreProps, SidebarSurface, SidebarTab } from "../src/client/dsh/sidebar-right"
import type { SlotEntry } from "../src/client/dsh/slots"
import {
  baseName,
  botFileTarget,
  parseFileAddress,
  SESSION_FILE_PATTERN,
} from "../src/client/file-address"
import {
  BOT_FILE_TAB_ID,
  BOT_FILE_TAB_KIND,
  botFileTabDefinition,
  type ClassifySession,
} from "../src/client/sidebar/file-tab"
import {
  createLockdownStatus,
  INITIAL_LOCKDOWN_STATUS,
  linksAvailable,
} from "../src/client/sidebar/lockdown-status"
import { lineOf, planReviewOf, urlOf } from "../src/client/sidebar/navigation-params"
import { RefusedFileTab, type RefusedFileTabProps } from "../src/client/sidebar/RefusedFileTab"
import { SessionRightbar, type SessionRightbarProps } from "../src/client/sidebar/SessionRightbar"
import { cornerStoreHandle, storeHandleOf } from "../src/client/sidebar/store-handle"
import { initialSweepMemory, planSweep, refusalKey } from "../src/client/sidebar/sweep-plan"
import {
  NavigationUnavailableError,
  runSweep,
  type SweepDeps,
} from "../src/client/sidebar/sweep-run"
import type { Translate } from "../src/client/types"
import { createViewer } from "../src/client/viewer"
import { t } from "./support/client"

const isBot = (sessionId: string) => sessionId === "b1"
const classify: ClassifySession = (sessionId) => ({ kind: isBot(sessionId) ? "bot" : "stock" })

describe("file addresses (copy of dsh-util-workspace-path parseFileAddress)", () => {
  it("reads session and absolute addresses, decoding segments", () => {
    expect(parseFileAddress("dsh-resource://file/session/b1/src/a%20b.ts")).toEqual({
      scope: "session",
      sessionId: "b1",
      path: "src/a b.ts",
    })
    // An absolute path outside the workspace keeps its spelling in the session's address.
    expect(parseFileAddress("dsh-resource://file/session/b1//tmp/x.txt")).toEqual({
      scope: "session",
      sessionId: "b1",
      path: "/tmp/x.txt",
    })
    expect(parseFileAddress("dsh-resource://file/absolute/home/me/n.md?x#y")).toEqual({
      scope: "absolute",
      path: "/home/me/n.md",
    })
    expect(parseFileAddress("dsh-resource://file/absolute//srv/share/a")).toEqual({
      scope: "absolute",
      path: "//srv/share/a",
    })
    expect(parseFileAddress("dsh-resource://file/session/b1/%E0%A4%A")).toBeUndefined()
    expect(parseFileAddress("dsh-resource://plan/x")).toBeUndefined()
    expect(parseFileAddress("dsh-resource://file/session/b1")).toBeUndefined()
  })

  it("names a bot file only for a bot session's non-empty session-scoped path", () => {
    expect(botFileTarget("dsh-resource://file/session/b1/a.md", isBot)).toEqual({
      sessionId: "b1",
      path: "a.md",
    })
    expect(botFileTarget("dsh-resource://file/session/w1/a.md", isBot)).toBeUndefined()
    expect(botFileTarget("dsh-resource://file/session/b1/", isBot)).toBeUndefined()
    expect(botFileTarget("dsh-resource://file/absolute/tmp/a", isBot)).toBeUndefined()
    expect(baseName("a/b/c.txt")).toBe("c.txt")
    expect(baseName("/")).toBe("/")
  })
})

describe("the bot file tab type", () => {
  it("claims every session file address at the extension band, but opens only bot sessions'", () => {
    const definition = botFileTabDefinition(classify)
    expect(definition).toMatchObject({
      id: BOT_FILE_TAB_ID,
      kind: BOT_FILE_TAB_KIND,
      patterns: [SESSION_FILE_PATTERN],
      priority: "extension",
    })
    expect(definition.canOpen("dsh-resource://file/session/b1/x/y.ts")).toBe(true)
    // A Workspace session's files stay with DSH's own viewers.
    expect(definition.canOpen("dsh-resource://file/session/w1/x/y.ts")).toBe(false)
    expect(definition.canOpen("dsh-resource://file/absolute/etc/hosts")).toBe(false)
    expect(definition.title("dsh-resource://file/session/b1/x/y.ts")).toBe("y.ts")
  })

  it("opens nothing while the session is unclassified", () => {
    const definition = botFileTabDefinition(() => ({ kind: "unknown" }))
    expect(definition.canOpen("dsh-resource://file/session/b1/x/y.ts")).toBe(false)
  })

  it("has a refusal body that never reads files", () => {
    expectTypeOf<RefusedFileTabProps>().toEqualTypeOf<{ readonly t: Translate }>()
    expect(renderToStaticMarkup(createElement(RefusedFileTab, { t }))).toBe(
      '<p class="dshb-files-note" role="alert">files.refused.lockdown</p>',
    )
  })
})

describe("DSH's sidebar store handle, from the header corner only", () => {
  function slots(initial: readonly SlotEntry[]) {
    let corner = initial
    const listeners = new Set<() => void>()
    const entriesOfSlot = vi.fn((key: string) => {
      expect(key).toBe("conversation.session.header.corner")
      return corner
    })
    return {
      entriesOfSlot,
      subscribe: vi.fn((key: string, listener: () => void) => {
        expect(key).toBe("conversation.session.header.corner")
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }),
      set(next: readonly SlotEntry[]) {
        corner = next
        for (const listener of [...listeners]) listener()
      },
    }
  }

  it("reads the corner head's store", () => {
    const handle = { create() {} }
    expect(storeHandleOf([{ component: "ExpandButton", store: handle }])).toEqual({
      state: "present",
      store: handle,
    })
    expect(storeHandleOf([{ component: "ExpandButton" }])).toEqual({ state: "missing" })
    expect(storeHandleOf([])).toEqual({ state: "missing" })
  })

  it("notifies only when the handle changes, with a stable snapshot", () => {
    const first = { create() {} }
    const fake = slots([{ component: "ExpandButton", store: first }])
    const handle = cornerStoreHandle(fake)
    const snapshot = handle.getSnapshot()
    expect(snapshot).toEqual({ state: "present", store: first })
    const listener = vi.fn()
    const off = handle.subscribe(listener)
    fake.set([{ component: "ExpandButton", store: first }])
    expect(listener).not.toHaveBeenCalled()
    expect(handle.getSnapshot()).toBe(snapshot)
    const second = { create() {} }
    fake.set([{ component: "ExpandButton", store: second }])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(handle.getSnapshot()).toEqual({ state: "present", store: second })
    fake.set([])
    expect(listener).toHaveBeenCalledTimes(2)
    expect(handle.getSnapshot()).toEqual({ state: "missing" })
    off()
    fake.set([{ component: "ExpandButton", store: first }])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("lets the Slot service's failures reach the caller", () => {
    const fake = slots([])
    fake.entriesOfSlot.mockImplementation(() => {
      throw new Error("Slot not declared")
    })
    expect(() => cornerStoreHandle(fake).getSnapshot()).toThrow("Slot not declared")
    fake.subscribe.mockImplementation(() => {
      throw new Error("no subscription")
    })
    expect(() =>
      cornerStoreHandle({ ...fake, entriesOfSlot: () => [] }).subscribe(() => {}),
    ).toThrow("no subscription")
  })
})

describe("the lockdown status", () => {
  it("makes file links available only with the handle, an unrefused registration, and no breakage", () => {
    expect(linksAvailable(INITIAL_LOCKDOWN_STATUS)).toBe(false)
    const present = { ...INITIAL_LOCKDOWN_STATUS, handle: "present" as const }
    expect(linksAvailable(present)).toBe(true)
    expect(linksAvailable({ ...present, registration: { state: "active" } })).toBe(true)
    expect(linksAvailable({ ...present, registration: { state: "refused", error: "taken" } })).toBe(
      false,
    )
    expect(linksAvailable({ ...present, broken: true })).toBe(false)
  })

  it("notifies on changes only, and derives the links' availability", () => {
    const status = createLockdownStatus()
    const listener = vi.fn()
    const links = vi.fn()
    status.subscribe(listener)
    status.linksAvailable.subscribe(links)
    status.setHandle("present")
    expect(status.linksAvailable.getSnapshot()).toBe(true)
    status.setHandle("present")
    status.setRegistration({ state: "idle" })
    expect(listener).toHaveBeenCalledTimes(1)
    status.setRegistration({ state: "active" })
    expect(listener).toHaveBeenCalledTimes(2)
    expect(links).toHaveBeenCalledTimes(1)
    status.markBroken()
    status.markBroken()
    expect(listener).toHaveBeenCalledTimes(3)
    expect(status.getSnapshot()).toEqual({
      handle: "present",
      registration: { state: "active" },
      broken: true,
    })
    expect(status.linksAvailable.getSnapshot()).toBe(false)
    expect(links).toHaveBeenCalledTimes(2)
  })
})

describe("navigation params", () => {
  it("reads a finite line, an http(s) URL and a plan review", () => {
    expect(lineOf({ line: 42 })).toBe(42)
    expect(lineOf({ line: Number.NaN })).toBeUndefined()
    expect(lineOf({ line: "42" })).toBeUndefined()
    expect(lineOf(undefined)).toBeUndefined()
    expect(urlOf({ url: "HTTPS://example.com/" })).toBe("HTTPS://example.com/")
    expect(urlOf({ url: "javascript:alert(1)" })).toBeUndefined()
    expect(urlOf(null)).toBeUndefined()
    expect(planReviewOf({ planReview: { markdown: "# P", title: "P" } })).toEqual({
      title: "P",
      markdown: "# P",
    })
    expect(planReviewOf({ planReview: { markdown: "# P", title: "" } })).toEqual({
      title: undefined,
      markdown: "# P",
    })
    expect(planReviewOf({ planReview: { title: "P" } })).toBeUndefined()
    expect(planReviewOf("x")).toBeUndefined()
  })
})

const tab = (id: string, kind: string, contentId = `sidebar://${kind}`): SidebarTab => ({
  id,
  kind,
  contentId,
})
const surface = (expanded: boolean, tabs: SidebarTab[]): SidebarSurface => ({
  layout: { expanded, tabs: Object.fromEntries(tabs.map((item) => [item.id, item])) },
})

describe("planSweep: what lands in a bot session's DSH sidebar layout", () => {
  /** Drive the planner through a sequence of layouts, as the seat's effect does. */
  function sweeper(atMount: SidebarSurface | undefined) {
    let memory = initialSweepMemory(atMount)
    return (next: SidebarSurface | undefined) => {
      const swept = planSweep(next, memory)
      memory = swept.memory
      return swept.plan
    }
  }

  it("closes the layout restored at mount without opening it, and does not toggle on it", () => {
    const restored = surface(true, [tab("t1", "guide"), tab("t2", "terminal")])
    const plan = sweeper(restored)(restored)
    expect(plan).toEqual({ actions: [], close: ["t2"], collapse: true })
  })

  it("routes an open that lands in the same tick as the mount", () => {
    const atMount = surface(false, [tab("t1", "files")])
    const step = sweeper(atMount)
    const plan = step(
      surface(true, [
        tab("t1", "files"),
        tab("t2", BOT_FILE_TAB_KIND, "dsh-resource://file/session/b1/a.md"),
      ]),
    )
    expect(plan.actions).toEqual([{ kind: "file", tabId: "t2" }])
    expect(plan.close).toEqual(["t1", "t2"])
  })

  it("routes a bot file, the Files page, a browser tab and a plan; refuses the rest", () => {
    const step = sweeper(surface(false, [tab("t1", "guide")]))
    const plan = step(
      surface(true, [
        tab("t1", "guide"),
        tab("t2", BOT_FILE_TAB_KIND, "dsh-resource://file/session/b1/a.md"),
        tab("t3", "files"),
        tab("t4", "browser"),
        tab("t5", "plan"),
        tab("t6", "terminal"),
      ]),
    )
    expect(plan.actions).toEqual([
      { kind: "file", tabId: "t2" },
      { kind: "browse" },
      { kind: "external", tabId: "t4" },
      { kind: "document", tabId: "t5" },
      { kind: "refused", tabId: "t6", tabKind: "terminal" },
    ])
    expect(plan.close).toEqual(["t2", "t3", "t4", "t5", "t6"])
    expect(plan.collapse).toBe(true)
  })

  it("toggles on an expansion that brought only the default page, each time", () => {
    const step = sweeper(undefined)
    // Materialized collapsed and empty: nothing.
    expect(step(surface(false, []))).toEqual({ actions: [], close: [], collapse: false })
    // The toggle shortcut seeds the guide.
    expect(step(surface(true, [tab("g", "guide")])).actions).toEqual([{ kind: "toggle" }])
    // Our collapse lands: nothing more (no re-entrant toggle).
    expect(step(surface(false, [tab("g", "guide")]))).toEqual({
      actions: [],
      close: [],
      collapse: false,
    })
    // Expanded again with the guide already there.
    expect(step(surface(true, [tab("g", "guide")])).actions).toEqual([{ kind: "toggle" }])
    expect(step(undefined).actions).toEqual([])
  })

  it("does not toggle again while a collapse does not take (no flapping)", () => {
    const step = sweeper(surface(false, [tab("g", "guide")]))
    expect(step(surface(true, [tab("g", "guide")])).actions).toEqual([{ kind: "toggle" }])
    // setExpanded(false) failed: the layout stays expanded, the next commits toggle nothing.
    for (let i = 0; i < 3; i += 1) {
      const plan = step(surface(true, [tab("g", "guide")]))
      expect(plan.actions).toEqual([])
      expect(plan.collapse).toBe(true)
    }
  })

  it("handles a tab once: after its close, and when its close failed", () => {
    const step = sweeper(surface(false, []))
    const opened = surface(true, [tab("t1", BOT_FILE_TAB_KIND, "dsh-resource://file/session/b1/a")])
    expect(step(opened).actions).toEqual([{ kind: "file", tabId: "t1" }])
    // closeIn threw: the tab is still there, closed again but not opened again.
    expect(step(opened)).toEqual({ actions: [], close: ["t1"], collapse: true })
    expect(step(surface(false, []))).toEqual({ actions: [], close: [], collapse: false })
  })
})

function deps(navigation: Record<string, { address: string; params?: unknown }>) {
  const viewer = createViewer()
  const closeIn = vi.fn()
  const setExpanded = vi.fn()
  const openExternal = vi.fn()
  const value: SweepDeps = {
    sessionId: "b1",
    sidebar: {
      closeIn,
      tabDomain: {
        occurrence: (_sessionId, { id }) => ({
          navigation: {
            getSnapshot: () => {
              const found = navigation[id]
              if (found === undefined) throw new Error("no such tab")
              return found
            },
          },
        }),
      },
    },
    actions: { open: vi.fn(), setExpanded },
    viewer,
    openExternal,
    t,
  }
  return { value, viewer, closeIn, setExpanded, openExternal }
}

describe("runSweep", () => {
  it("opens a bot file at the link's line, then closes the tab and collapses", () => {
    const fake = deps({
      t2: { address: "dsh-resource://file/session/b1/src/a.ts", params: { line: 42 } },
    })
    const order: string[] = []
    fake.closeIn.mockImplementation(() => order.push("close"))
    fake.viewer.subscribe(() => order.push("viewer"))
    const outcome = runSweep(
      { actions: [{ kind: "file", tabId: "t2" }], close: ["t2"], collapse: true },
      fake.value,
    )
    expect(outcome).toEqual({ broken: false })
    expect(fake.viewer.of("b1")).toMatchObject({
      open: true,
      content: { kind: "file", path: "src/a.ts", line: 42 },
    })
    expect(order).toEqual(["viewer", "close"])
    expect(fake.closeIn).toHaveBeenCalledWith("b1", "t2")
    expect(fake.setExpanded).toHaveBeenCalledWith("b1", false)
  })

  it("opens http(s) browser tabs externally and shows plan reviews; refuses with a notice otherwise", () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {})
    const fake = deps({
      web: { address: "sidebar://browser", params: { url: "https://example.com/" } },
      js: { address: "sidebar://browser", params: { url: "javascript:alert(1)" } },
      plan: {
        address: "dsh-resource://plan-review/x",
        params: { planReview: { markdown: "# P", title: "P" } },
      },
      untitled: {
        address: "dsh-resource://plan-review/y",
        params: { planReview: { markdown: "Q" } },
      },
      other: { address: "dsh-resource://file/session/w1/a.ts" },
    })
    runSweep(
      {
        actions: [
          { kind: "external", tabId: "web" },
          { kind: "document", tabId: "plan" },
        ],
        close: [],
        collapse: false,
      },
      fake.value,
    )
    expect(fake.openExternal).toHaveBeenCalledWith("https://example.com/")
    expect(fake.viewer.of("b1").content).toMatchObject({
      kind: "document",
      title: "P",
      markdown: "# P",
    })
    expect(fake.viewer.getSnapshot().notices.b1).toBeUndefined()
    runSweep(
      { actions: [{ kind: "document", tabId: "untitled" }], close: [], collapse: false },
      fake.value,
    )
    expect(fake.viewer.of("b1").content).toMatchObject({ kind: "document", title: "files.plan" })

    runSweep(
      {
        actions: [{ kind: "external", tabId: "js" }],
        close: [],
        collapse: false,
      },
      fake.value,
    )
    expect(fake.openExternal).toHaveBeenCalledTimes(1)
    expect(fake.viewer.getSnapshot().notices.b1).toMatchObject({ key: "notice.refused.browser" })

    runSweep(
      {
        actions: [
          { kind: "refused", tabId: "x", tabKind: "terminal" },
          // Our kind, but the address is not this bot session's.
          { kind: "file", tabId: "other" },
        ],
        close: ["x"],
        collapse: false,
      },
      fake.value,
    )
    expect(fake.viewer.getSnapshot().notices.b1).toMatchObject({ key: "notice.refused.file" })
    expect(refusalKey("terminal")).toBe("notice.refused.terminal")
    expect(refusalKey("someone.elses")).toBe("notice.refused")
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('"terminal"'))
    fake.viewer.dismiss("b1")
    expect(fake.viewer.getSnapshot().notices.b1).toBeUndefined()
    debug.mockRestore()
  })

  it("toggles and browses; a failing close is logged, not thrown", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fake = deps({})
    fake.closeIn.mockImplementation(() => {
      throw new Error("boom")
    })
    runSweep({ actions: [{ kind: "toggle" }], close: ["a"], collapse: false }, fake.value)
    expect(fake.viewer.of("b1").open).toBe(true)
    runSweep({ actions: [{ kind: "toggle" }], close: [], collapse: false }, fake.value)
    expect(fake.viewer.of("b1").open).toBe(false)
    const outcome = runSweep(
      { actions: [{ kind: "browse" }], close: [], collapse: false },
      fake.value,
    )
    expect(outcome).toEqual({ broken: false })
    expect(fake.viewer.of("b1")).toEqual({ open: true, content: { kind: "browse" } })
    expect(error).toHaveBeenCalledWith(
      "bot-core: closing a stock sidebar tab failed",
      expect.any(Error),
    )
    error.mockRestore()
  })

  it("reports a navigation it cannot read as broken, without a refusal, and carries on", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fake = deps({
      t3: { address: "dsh-resource://file/session/b1/b.md" },
    })
    const outcome = runSweep(
      {
        actions: [
          { kind: "file", tabId: "gone" },
          { kind: "file", tabId: "t3" },
        ],
        close: ["gone", "t3"],
        collapse: true,
      },
      fake.value,
    )
    expect(outcome).toEqual({ broken: true })
    expect(error).toHaveBeenCalledWith(
      'bot-core: routing a "file" sidebar open failed',
      expect.any(NavigationUnavailableError),
    )
    expect(fake.viewer.getSnapshot().notices.b1).toBeUndefined()
    expect(fake.viewer.of("b1")).toMatchObject({ content: { kind: "file", path: "b.md" } })
    expect(fake.closeIn).toHaveBeenCalledTimes(2)
    expect(fake.setExpanded).toHaveBeenCalledWith("b1", false)
    error.mockRestore()
  })

  it("isolates a failing action from the next", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const fake = deps({})
    const openExternal = vi.fn()
    vi.spyOn(fake.viewer, "toggle").mockImplementation(() => {
      throw new Error("viewer down")
    })
    const outcome = runSweep(
      { actions: [{ kind: "toggle" }, { kind: "browse" }], close: [], collapse: false },
      { ...fake.value, openExternal },
    )
    expect(outcome).toEqual({ broken: false })
    expect(fake.viewer.of("b1").content).toEqual({ kind: "browse" })
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })

  it("forgets the viewer state of sessions that are no longer a bot's", () => {
    const viewer = createViewer()
    viewer.openFile("b1", "a")
    viewer.openFile("gone", "a")
    viewer.notify("gone", "notice.refused")
    viewer.forget(isBot)
    expect(Object.keys(viewer.getSnapshot().sessions)).toEqual(["b1"])
    expect(viewer.getSnapshot().notices).toEqual({})
    const before = viewer.getSnapshot()
    viewer.forget(isBot)
    expect(viewer.getSnapshot()).toBe(before)
  })
})

describe("the rightbar seat", () => {
  const face = {
    sidebar: { closeIn: vi.fn(), tabDomain: { occurrence: vi.fn() } },
    viewer: createViewer(),
    classify,
    lockdown: { markBroken: vi.fn() },
    openExternal: vi.fn(),
    t,
  }

  it("draws nothing, and reads no store without the handle or for another session", () => {
    const useStore = vi.fn()
    const render = (props: SessionRightbarProps) =>
      renderToStaticMarkup(createElement(SessionRightbar, props))
    expect(render({ ...face, sessionId: "b1", handle: "missing" })).toBe("")
    const store = {
      handle: "present" as const,
      useStore: useStore as SidebarStoreProps["useStore"],
      actions: { open: vi.fn(), setExpanded: vi.fn() },
    }
    expect(render({ ...face, ...store, sessionId: "w1" })).toBe("")
    expect(render({ ...face, ...store, sessionId: undefined })).toBe("")
    expect(useStore).not.toHaveBeenCalled()
    // Server rendering warns that the sweep's layout effect does not run there.
    const warning = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(render({ ...face, ...store, sessionId: "b1" })).toBe("")
    expect(useStore).toHaveBeenCalledTimes(1)
    warning.mockRestore()
  })
})
