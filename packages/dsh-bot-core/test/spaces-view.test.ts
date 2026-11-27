import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { BotsSection } from "../src/client/BotsSection"
import type { ActionProps } from "../src/client/face"
import { createStore } from "../src/client/observable"
import type { FrameConfirmation } from "../src/client/settings-frame/flow"
import { spaceErrorText, spaceFailureText } from "../src/client/spaces/failure-text"
import { SpaceRequestError } from "../src/client/spaces/feed"
import { createSpaceFlows, type SpaceTab } from "../src/client/spaces/flows"
import { createSpaceFrame } from "../src/client/spaces/frame"
import { spaceMenuActions } from "../src/client/spaces/menu"
import {
  activeSpaceId,
  FRAME_REFRESH_LEAD_MS,
  frameRefreshDelay,
  type SpaceSlotEntry,
  spacePanelId,
  spaceSlotEntries,
  spacesByBot,
} from "../src/client/spaces/model"
import { parseSpaceDetail, spaceDetailOf } from "../src/client/spaces/pages"
import { reconcileSpaceSlots } from "../src/client/spaces/registrar"
import { SPACE_FRAME_SANDBOX, SpaceFrameView } from "../src/client/spaces/SpacePanel"
import {
  deriveBotNodes,
  flattenTree,
  NO_SPACES,
  selectedKey,
  type TreeView,
  treeKeyAction,
} from "../src/client/tree"
import type { BotSpaceFrame } from "../src/shared/spaces"
import { bot, t, value } from "./support/client"
import { fakeSpacesFace, idleFlows, spacesReady, spaceView } from "./support/spaces-client"

describe("Space slot entries", () => {
  const a = bot("a", "ma")
  const b = { ...bot("b", "mb"), createdAt: 1 }

  it("orders Spaces by bot (as the tree, newest first) and by creation", () => {
    const entries = spaceSlotEntries(
      [
        spaceView("a", "two", { createdAt: 2, pinned: true }),
        spaceView("a", "one", { createdAt: 1 }),
        spaceView("b", "only", { pinned: true }),
        spaceView("gone", "orphan"),
      ],
      [a, b],
    )
    expect(entries.map((entry) => [entry.id, entry.order, entry.pinned])).toEqual([
      ["bot-core.space.b.only", 100, true],
      ["bot-core.space.a.one", 200, false],
      ["bot-core.space.a.two", 201, true],
    ])
    expect(entries[0]?.label).toBe("Space only")
  })

  it("names the panel of a Space and finds the active one", () => {
    const space = spaceView("a", "demo")
    expect(spacePanelId(space)).toBe("bot-core.space.a.demo")
    expect(activeSpaceId("bot-core.space.a.demo", [space])).toBe("a:demo")
    expect(activeSpaceId("schedules", [space])).toBeUndefined()
    expect(activeSpaceId(null, [space])).toBeUndefined()
  })

  it("keeps the settings detail of a Space and its intent", () => {
    expect(parseSpaceDetail(spaceDetailOf("a:demo", "link"))).toEqual({
      spaceId: "a:demo",
      intent: "link",
    })
    expect(parseSpaceDetail(spaceDetailOf("a:demo"))).toEqual({
      spaceId: "a:demo",
      intent: undefined,
    })
    expect(parseSpaceDetail(null)).toBeUndefined()
  })
})

describe("reconcileSpaceSlots", () => {
  const entry = (id: string, fields: Partial<SpaceSlotEntry> = {}): SpaceSlotEntry => ({
    id,
    spaceId: id,
    botId: "a",
    label: id,
    order: 100,
    pinned: false,
    ...fields,
  })

  function harness(initial: readonly SpaceSlotEntry[]) {
    const entries = createStore<readonly SpaceSlotEntry[]>(initial)
    const live = { main: new Map<string, number>(), panel: new Map<string, string>() }
    const log: string[] = []
    const dispose = reconcileSpaceSlots(entries, {
      main(item) {
        log.push(`main+${item.id}`)
        live.main.set(item.id, (live.main.get(item.id) ?? 0) + 1)
        return () => {
          log.push(`main-${item.id}`)
          live.main.delete(item.id)
        }
      },
      panel(item) {
        log.push(`panel+${item.id}`)
        live.panel.set(item.id, item.label)
        return () => {
          log.push(`panel-${item.id}`)
          live.panel.delete(item.id)
        }
      },
    })
    return { entries, live, log, dispose }
  }

  it("puts every Space in main and only the pinned ones in the panel list", () => {
    const { live } = harness([entry("x", { pinned: true }), entry("y")])
    expect([...live.main.keys()]).toEqual(["x", "y"])
    expect([...live.panel.keys()]).toEqual(["x"])
  })

  it("registers and disposes as Spaces come and go", () => {
    const { entries, live, log, dispose } = harness([entry("x", { pinned: true })])
    entries.set([entry("x", { pinned: true }), entry("y", { pinned: true })])
    expect([...live.panel.keys()]).toEqual(["x", "y"])
    entries.set([entry("y", { pinned: true })])
    expect([...live.main.keys()]).toEqual(["y"])
    expect([...live.panel.keys()]).toEqual(["y"])
    expect(log).toContain("main-x")
    dispose()
    expect(live.main.size + live.panel.size).toBe(0)
  })

  it("changes only the panel list on a pin, a title or an order, never main", () => {
    const { entries, live, log } = harness([entry("x")])
    entries.set([entry("x", { pinned: true })])
    entries.set([entry("x", { pinned: true, label: "Renamed" })])
    expect(live.panel.get("x")).toBe("Renamed")
    entries.set([entry("x", { pinned: false, label: "Renamed" })])
    expect(live.panel.size).toBe(0)
    expect(live.main.get("x")).toBe(1)
    expect(log.filter((line) => line.startsWith("main"))).toEqual(["main+x"])
  })

  it("logs a refused registration and keeps the others", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const entries = createStore<readonly SpaceSlotEntry[]>([entry("x"), entry("y")])
    const mains: string[] = []
    reconcileSpaceSlots(entries, {
      main(item) {
        if (item.id === "x") throw new Error("taken")
        mains.push(item.id)
        return () => {}
      },
      panel: () => () => {},
    })
    expect(mains).toEqual(["y"])
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})

describe("the Space frame", () => {
  function scene(revision: number | null, frames: BotSpaceFrame[]) {
    const revisions = createStore<number | null>(revision)
    const generation = createStore<object | undefined>({})
    const timers: { ms: number; run: () => void; cancelled: boolean }[] = []
    const fetch = vi.fn(async () => {
      const next = frames.shift()
      if (next === undefined) throw new Error("no more frames")
      return next
    })
    const frame = createSpaceFrame({
      fetch,
      revision: revisions,
      generation,
      now: () => 0,
      later(ms, run) {
        const timer = { ms, run, cancelled: false }
        timers.push(timer)
        return () => {
          timer.cancelled = true
        }
      },
    })
    return { frame, fetch, revisions, generation, timers }
  }
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
  const HOURS_12 = 12 * 60 * 60_000

  it("shows the empty state until a revision is published", async () => {
    const { frame, fetch, revisions } = scene(null, [
      { url: "/bot-spaces/s/A/", expiresAt: HOURS_12 },
    ])
    expect(frame.getSnapshot()).toEqual({ status: "unpublished" })
    expect(fetch).not.toHaveBeenCalled()
    revisions.set(1)
    await settle()
    expect(frame.getSnapshot()).toEqual({ status: "ready", url: "/bot-spaces/s/A/", load: 1 })
  })

  it("reloads the iframe with the same token when the revision changes", async () => {
    const { frame, fetch, revisions } = scene(1, [{ url: "/bot-spaces/s/A/", expiresAt: HOURS_12 }])
    await settle()
    revisions.set(2)
    expect(frame.getSnapshot()).toEqual({ status: "ready", url: "/bot-spaces/s/A/", load: 2 })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("takes a new token ten minutes before it expires, and after a reconnection", async () => {
    const { frame, fetch, timers, generation } = scene(1, [
      { url: "/bot-spaces/s/A/", expiresAt: HOURS_12 },
      { url: "/bot-spaces/s/B/", expiresAt: 2 * HOURS_12 },
      { url: "/bot-spaces/s/C/", expiresAt: 3 * HOURS_12 },
    ])
    await settle()
    expect(timers[0]?.ms).toBe(HOURS_12 - FRAME_REFRESH_LEAD_MS)
    timers[0]?.run()
    await settle()
    expect(frame.getSnapshot()).toEqual({ status: "ready", url: "/bot-spaces/s/B/", load: 2 })
    generation.set({})
    await settle()
    expect(timers[1]?.cancelled).toBe(true)
    expect(frame.getSnapshot()).toEqual({ status: "ready", url: "/bot-spaces/s/C/", load: 3 })
    expect(fetch).toHaveBeenCalledTimes(3)
    frame.dispose()
    expect(timers[2]?.cancelled).toBe(true)
  })

  it("reports a refused frame and retries on request", async () => {
    const { frame, fetch, revisions } = scene(null, [])
    fetch.mockRejectedValueOnce(
      new SpaceRequestError({
        kind: "refused",
        code: "bot-space/not-found",
        message: "no such space",
      }),
    )
    revisions.set(1)
    await settle()
    expect(frame.getSnapshot()).toMatchObject({ status: "failed", failure: { kind: "refused" } })
    fetch.mockResolvedValueOnce({ url: "/bot-spaces/s/D/", expiresAt: HOURS_12 })
    frame.retry()
    await settle()
    expect(frame.getSnapshot()).toMatchObject({ status: "ready", url: "/bot-spaces/s/D/" })
  })

  it("never refreshes in a tight loop when the clock is off", () => {
    expect(frameRefreshDelay(0, HOURS_12)).toBe(60_000)
  })
})

describe("SpaceFrameView", () => {
  const space = spaceView("a", "demo")
  const render = (state: Parameters<typeof SpaceFrameView>[0]["state"]) =>
    renderToStaticMarkup(createElement(SpaceFrameView, { t, space, state, onRetry() {} }))

  it("sandboxes the iframe without same-origin and sends no referrer", () => {
    const html = render({ status: "ready", url: "/bot-spaces/s/TOKEN/", load: 1 })
    expect(html).toContain('src="/bot-spaces/s/TOKEN/"')
    expect(html).toContain(`sandbox="${SPACE_FRAME_SANDBOX}"`)
    expect(SPACE_FRAME_SANDBOX).toBe("allow-scripts allow-forms")
    expect(html).toContain('referrerPolicy="no-referrer"')
    expect(html).not.toContain("allow-same-origin")
  })

  it("shows the empty state of an unpublished Space and a failure with a retry", () => {
    expect(render({ status: "unpublished" })).toContain("spaces.unpublished")
    const failed = render({ status: "failed", failure: { kind: "connection", message: "down" } })
    expect(failed).toContain("spaces.error.connection(down)")
    expect(failed).toContain("spaces.panel.retry")
  })
})

describe("Space flows", () => {
  const space = spaceView("a", "demo")

  function api() {
    return {
      ...idleFlows,
      frame: vi.fn(),
      setPinned: vi.fn(async () => space),
      setVisibility: vi.fn(async () => space),
      setVisitorWrites: vi.fn(async () => space),
      createLink: vi.fn(async () => ({
        id: "abc",
        url: null,
        relativeUrl: "/bot-spaces/v/T/",
        expiresAt: 1,
      })),
      revokeLink: vi.fn(async () => space),
      discard: vi.fn(async () => ({ discarded: true as const })),
      setPublicBaseUrl: vi.fn(),
    }
  }

  it("asks before making a Space public or letting visitors write, not before undoing", async () => {
    const remote = api()
    const flows = createSpaceFlows({ api: remote, t, openTab: () => null })
    const refuse = vi.fn(async (_request: FrameConfirmation) => false)
    await flows.setVisibility(space, "public", refuse)
    expect(remote.setVisibility).not.toHaveBeenCalled()
    await flows.setVisibility(space, "public", async () => true)
    expect(remote.setVisibility).toHaveBeenCalledWith("a:demo", "public")
    const ask = vi.fn(async (_request: FrameConfirmation) => true)
    await flows.setVisibility({ ...space, visibility: "public" }, "owner", ask)
    await flows.setVisitorWrites({ ...space, visitorWrites: true }, false, ask)
    expect(ask).not.toHaveBeenCalled()
    await flows.setVisitorWrites(space, true, refuse)
    expect(remote.setVisitorWrites).toHaveBeenCalledTimes(1)
    expect(refuse.mock.calls.map(([request]) => request.title)).toEqual([
      "spaces.confirm.public.title(Space demo)",
      "spaces.confirm.writes.title(Space demo)",
    ])
  })

  it("deletes only after a danger confirmation", async () => {
    const remote = api()
    const flows = createSpaceFlows({ api: remote, t, openTab: () => null })
    const ask = vi.fn(async (_request: FrameConfirmation) => true)
    expect(await flows.discard(space, ask)).toBe(true)
    expect(ask.mock.calls[0]?.[0].tone).toBe("danger")
    expect(remote.discard).toHaveBeenCalledWith("a:demo")
  })

  it("opens the wrapper of a one-day link in a tab it opened first", async () => {
    const remote = api()
    const tab: SpaceTab = { navigate: vi.fn(), close: vi.fn() }
    const flows = createSpaceFlows({ api: remote, t, openTab: () => tab })
    await flows.openInNewTab(space)
    expect(remote.createLink).toHaveBeenCalledWith("a:demo", {
      label: "spaces.link.webUi",
      days: 1,
    })
    expect(tab.navigate).toHaveBeenCalledWith("/bot-spaces/v/T/")
    remote.createLink.mockRejectedValueOnce(new Error("down"))
    await expect(flows.openInNewTab(space)).rejects.toThrow("down")
    expect(tab.close).toHaveBeenCalledOnce()
    const blocked = createSpaceFlows({ api: remote, t, openTab: () => null })
    await expect(blocked.openInNewTab(space)).rejects.toThrow()
  })

  it("words every refusal and the blocked tab", async () => {
    expect(
      spaceFailureText(t, { kind: "refused", code: "bot-space/invalid-base-url", message: "bad" }),
    ).toBe("spaces.error.invalidBaseUrl(bad)")
    const blocked = createSpaceFlows({ api: api(), t, openTab: () => null })
    const error = await blocked.openInNewTab(space).catch((cause: unknown) => cause)
    expect(spaceErrorText(t, error)).toBe("spaces.error.tabBlocked")
  })
})

describe("the Space menu", () => {
  it("offers pin, the new tab, a link, publishing, settings and deletion", () => {
    const face = fakeSpacesFace()
    const actions = spaceMenuActions(spaceView("a", "demo"), face, t)
    expect(actions.map((action) => [action.id, action.label])).toEqual([
      ["pin", "spaces.menu.pin"],
      ["open-tab", "spaces.openTab"],
      ["link", "spaces.menu.createLink"],
      ["visibility", "spaces.menu.makePublic"],
      ["settings", "spaces.menu.settings"],
      ["delete", "spaces.menu.delete"],
    ])
    const pinned = spaceMenuActions(
      spaceView("a", "demo", { pinned: true, visibility: "public", revision: null }),
      face,
      t,
    )
    expect(pinned.find((action) => action.id === "pin")?.label).toBe("spaces.menu.unpin")
    expect(pinned.find((action) => action.id === "visibility")?.label).toBe(
      "spaces.menu.makePrivate",
    )
    expect(pinned.find((action) => action.id === "open-tab")?.disabled).toBe(true)
  })
})

describe("Spaces in the Bots tree", () => {
  const a = bot("a", "ma", ["a1"])
  const list = {
    phase: "ready" as const,
    ids: ["ma", "a1"],
    byId: {
      ma: {
        id: "ma",
        displayTitle: "ma",
        running: false,
        blank: false,
        updatedAt: 0,
        retainedBy: { mainView: 1 },
      },
      a1: { id: "a1", displayTitle: "a1", title: "a1", running: false, blank: false, updatedAt: 0 },
    },
  }
  const workspaces = { phase: "ready" as const, items: [], archivedSessionIds: [] }
  const spaces = [spaceView("a", "one", { pinned: true }), spaceView("a", "two", { createdAt: 1 })]
  const view = (expanded: boolean | undefined, active?: string): TreeView => ({
    expansion: { a: true },
    archivedShown: {},
    windows: {},
    spaces: {
      byBot: spacesByBot(spaces),
      expansion: expanded === undefined ? {} : { a: expanded },
      active,
    },
  })

  it("adds a Spaces row after the sessions and the Spaces under it", () => {
    const nodes = deriveBotNodes([a], list, workspaces, view(true))
    expect(flattenTree(nodes).map((item) => [item.key, item.level])).toEqual([
      ["bot:a", 1],
      ["session:ma", 2],
      ["session:a1", 2],
      ["spaces:a", 2],
      ["space:a:one", 3],
      ["space:a:two", 3],
    ])
    expect(flattenTree(deriveBotNodes([a], list, workspaces, view(false))).at(-1)).toMatchObject({
      key: "spaces:a",
      expanded: false,
      expands: "spaces",
    })
    expect(
      flattenTree(deriveBotNodes([bot("b", "mb")], list, workspaces, view(true))),
    ).toHaveLength(1)
    expect(
      deriveBotNodes([a], list, workspaces, { ...view(true), spaces: NO_SPACES })[0]?.spaces,
    ).toBeUndefined()
  })

  it("selects the open Space instead of the session and follows it when not expanded", () => {
    const nodes = deriveBotNodes([a], list, workspaces, view(undefined, "a:two"))
    expect(nodes[0]?.mainSelected).toBe(false)
    expect(nodes[0]?.spaces?.expanded).toBe(true)
    expect(selectedKey(nodes)).toBe("space:a:two")
    const folded = deriveBotNodes([a], list, workspaces, view(false, "a:two"))
    expect(selectedKey(folded)).toBe("spaces:a")
  })

  it("expands, enters and leaves the Spaces row with the arrow keys", () => {
    const items = flattenTree(deriveBotNodes([a], list, workspaces, view(true)))
    expect(treeKeyAction(items, "spaces:a", "ArrowRight")).toEqual({
      kind: "focus",
      key: "space:a:one",
    })
    expect(treeKeyAction(items, "spaces:a", "ArrowLeft")).toMatchObject({ kind: "collapse" })
    expect(treeKeyAction(items, "space:a:two", "ArrowLeft")).toEqual({
      kind: "focus",
      key: "spaces:a",
    })
    expect(treeKeyAction(items, "space:a:two", "ArrowRight")).toBeUndefined()
    expect(treeKeyAction(items, "space:a:one", "Enter")).toMatchObject({
      kind: "activate",
      item: { activates: { kind: "space", spaceId: "a:one" } },
    })
    const folded = flattenTree(deriveBotNodes([a], list, workspaces, view(false)))
    expect(treeKeyAction(folded, "spaces:a", "ArrowRight")).toMatchObject({ kind: "expand" })
    expect(treeKeyAction(folded, "spaces:a", "ArrowLeft")).toEqual({ kind: "focus", key: "bot:a" })
  })

  it("draws the rows with a pin mark and a Public tag", () => {
    const face = fakeSpacesFace({
      state: spacesReady([
        spaceView("x", "one", { pinned: true }),
        spaceView("x", "two", { visibility: "public", createdAt: 1 }),
      ]),
    })
    face.spacesExpansion.set("x", true)
    const html = renderToStaticMarkup(createElement(BotsSection, sectionProps(face)))
    expect(html).toContain('data-dshb-key="spaces:x"')
    expect(html).toContain('data-dshb-space="x:one"')
    expect(html).toContain('aria-label="spaces.pinned"')
    expect(html).toContain("data-dshb-space-public")
  })
})

function sectionProps(spaces: ReturnType<typeof fakeSpacesFace>): ActionProps {
  const idle = value({ state: "idle" as const })
  return {
    wide: true,
    t,
    bots: value({
      status: "ready" as const,
      snapshot: { bots: [bot("x", "m1")], pending: [], preparingSessionIds: [] },
    }),
    registrations: {
      shell: idle,
      rightbar: idle,
      mainComposer: idle,
      modelSeat: idle,
      permissionSeat: idle,
    },
    status: value({}),
    waiting: value({}),
    incidents: value({}),
    managed: Object.assign(value({ sessions: [] }), {
      entrust: () => {},
      release: () => {},
      setAnswerer: () => {},
      dispose: () => {},
    }),
    sessions: value({ phase: "ready" as const, ids: [], byId: {} }),
    workspaces: value({ phase: "ready" as const, items: [], archivedSessionIds: [] }),
    openSession() {},
    notifyArchivedNotOpenable() {},
    newSession() {},
    createBot: async () => {},
    pending: { retryCreate() {}, discardCreate() {}, retryRemove() {}, dismissRemove() {} },
    progress: value<string | null>(null),
    openProgress() {},
    clearError() {},
    openSettings() {},
    confirmDelete() {},
    openGlobalSettings() {},
    globalSettingsAttention: value(null),
    createDialog: createStore(false),
    expansion: Object.assign(value({ x: true }), { set() {} }),
    setExpanded() {},
    archivedView: Object.assign(value({}), { set() {} }),
    setArchivedShown() {},
    startNewMain() {},
    windows: {
      getSnapshot: () => ({}),
      subscribe: () => () => {},
      raise() {},
      toggle() {},
      reset() {},
    },
    archive: { archive() {}, unarchive() {} },
    menuBot: value(undefined),
    menuOpener: value(undefined),
    openBotMenu() {},
    menuSession: value(undefined),
    openSessionMenu() {},
    spaces,
  }
}
