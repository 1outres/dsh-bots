import { createElement, Fragment, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { BotFilesClient } from "../src/client/files"
import { createSessionModels, type FilesFace } from "../src/client/files/files-face"
import type {
  BotsState,
  RegistrationStatus,
  SessionClass,
} from "../src/client/session-classification"
import type { ShellSlotProps } from "../src/client/shell/face"
import { createNoticeDismissal } from "../src/client/shell/notice-dismissal"
import { ShellBoundary } from "../src/client/shell/ShellBoundary"
import { barKey } from "../src/client/shell/ShellMenuBar"
import { ShellRoot } from "../src/client/shell/ShellRoot"
import { createSidePanels, type SidePanels } from "../src/client/shell/side-panels"
import { builtinShellEntries, createShellMenu } from "../src/client/shell-menu"
import type { SessionListState, SessionSummary } from "../src/client/types"
import { createViewer, type Viewer } from "../src/client/viewer"
import { bot, idleApprovals, idleConnectorPanels, t, value } from "./support/client"
import { notesFace } from "./support/notes"

/** A viewer face whose Remote is never reached while the panel stays closed. */
function filesFace(viewer: Viewer = createViewer()): FilesFace {
  const models = createSessionModels({} as BotFilesClient, { set: () => 0, clear: () => {} })
  return {
    viewer,
    width: { ...value(420), resize: () => {} },
    linksAvailable: value(true),
    treeOf: models.treeOf,
    searchOf: models.searchOf,
    previewOf: models.previewOf,
  }
}

const target = bot("x", "m1")
const READY: BotsState = {
  status: "ready",
  snapshot: { bots: [target], pending: [], preparingSessionIds: [] },
}
const known: SessionClass = { kind: "bot", botId: "x", bot: target, source: "bots" }
const pending: SessionClass = { kind: "bot", botId: "x", bot: undefined, source: "preset" }

const summary = (id: string): SessionSummary => ({
  id,
  displayTitle: id,
  running: false,
  blank: false,
  updatedAt: 0,
  retainedBy: { mainView: 1 },
})
const list = (ids: string[]): SessionListState => ({
  phase: "ready",
  ids,
  byId: Object.fromEntries(ids.map((id) => [id, summary(id)])),
})

function menuOf(viewer: Viewer, panels: SidePanels = createSidePanels(viewer)) {
  const menu = createShellMenu()
  for (const item of builtinShellEntries({
    viewer,
    panels,
    approvals: idleApprovals,
    connectors: idleConnectorPanels.connectors,
  })) {
    menu.register(item)
  }
  return menu
}

function props(overrides: Partial<ShellSlotProps> = {}) {
  const renderFactorySlot = vi.fn((): ReactNode => "[content]")
  const viewer = createViewer()
  const panels = createSidePanels(viewer)
  const shellProps: ShellSlotProps = {
    t,
    sessionId: "m1",
    useSession: (selector) => selector({ blank: false, running: false, openState: "open" }),
    useConversation: (selector) => selector({ activeTargets: new Set() }),
    useSessions: (selector) => selector(list(["m1"])),
    renderFactorySlot,
    classification: value(known),
    bots: value(READY),
    rightbarRegistration: value<RegistrationStatus>({ state: "active" }),
    progress: value<string | null>(null),
    pending: { retryCreate() {}, discardCreate() {}, retryRemove() {}, dismissRemove() {} },
    lockdownNotice: createNoticeDismissal(),
    menu: menuOf(viewer, panels),
    openSettings: () => {},
    status: value({}),
    clearError: () => {},
    approvals: idleApprovals,
    actionsWidth: { ...value(420), resize: () => {} },
    panels,
    connectorPanels: idleConnectorPanels,
    renderSlot: () => null,
    files: filesFace(viewer),
    notes: notesFace(),
    ...overrides,
  }
  return { shellProps, renderFactorySlot }
}

const render = (shellProps: ShellSlotProps) =>
  renderToStaticMarkup(createElement(ShellRoot, shellProps))

const blank = (overrides: Partial<ShellSlotProps> = {}) =>
  props({
    useSession: (selector) => selector({ blank: true, running: false, openState: "open" }),
    ...overrides,
  })

describe("shell menu keys", () => {
  it("moves through the vertical toolbar with arrows, Home and End", () => {
    expect(barKey("ArrowDown", 0, 3)).toBe(1)
    expect(barKey("ArrowDown", 2, 3)).toBe(0)
    expect(barKey("ArrowUp", 0, 3)).toBe(2)
    expect(barKey("Home", 2, 3)).toBe(0)
    expect(barKey("End", 0, 3)).toBe(2)
    expect(barKey("Enter", 0, 3)).toBeUndefined()
  })
})

describe("ShellRoot", () => {
  it("wraps everything it renders in its boundary", () => {
    expect(ShellRoot(props().shellProps).type).toBe(ShellBoundary)
  })

  it("shows only a neutral placeholder while the session is unclassified", () => {
    const { shellProps, renderFactorySlot } = props({ classification: value({ kind: "unknown" }) })
    const html = render(shellProps)
    expect(html).toContain('data-dshb-shell-classifying=""')
    expect(html).toContain("shell.classifying")
    expect(html).not.toContain("<header")
    expect(html).not.toContain('role="toolbar"')
    expect(renderFactorySlot).not.toHaveBeenCalled()
  })

  it("draws nothing for a stock session or a settled main view without a session", () => {
    const stock = value<SessionClass>({ kind: "stock" })
    expect(render(props({ classification: stock }).shellProps)).toBe("")
    expect(render(props({ sessionId: undefined, classification: stock }).shellProps)).toBe("")
  })

  it("keeps the neutral placeholder while the main view has no session yet and is unknown", () => {
    const html = render(
      props({ sessionId: undefined, classification: value({ kind: "unknown" }) }).shellProps,
    )
    expect(html).toContain('data-dshb-shell-classifying=""')
  })

  it("shows the bot's header, Chat only and the menu bar, without DSH's header", () => {
    const { shellProps, renderFactorySlot } = props()
    const html = render(shellProps)
    expect(html).toContain(
      '<span class="dshb-shell-session" title="m1" data-dshb-shell-session="">m1</span>',
    )
    expect(html).toContain('data-dshb-shell-entry="bot-core.actions"')
    expect(html).toContain('aria-label="shell.actions(Bot x)"')
    expect(html).not.toContain("data-dshb-shell-menu-button")
    expect(html).toContain('data-dshb-shell=""')
    expect(html).toContain('data-phase="active"')
    expect(html).toContain('data-bot-id="x"')
    expect(html).toContain(
      '<h1 class="dshb-shell-name" title="Bot x" tabindex="-1" data-dshb-shell-name="">Bot x</h1>',
    )
    expect(html).toContain('aria-label="shell.settings(Bot x)"')
    expect(html).toMatch(/data-dshb-shell-settings="" aria-haspopup="dialog"/)
    expect(html).toContain('role="toolbar"')
    expect(html).toContain('data-dshb-shell-entry="bot-core.files"')
    expect(html).not.toContain('data-dshb-shell-entry="bot-core.new-session"')
    expect(html).not.toContain('data-dshb-shell-entry="bot-core.settings"')
    expect(html).toContain('aria-label="shell.files(Bot x)"')
    expect(html).toContain("[content]")
    expect(renderFactorySlot).toHaveBeenCalledWith(
      "conversation.content",
      { variant: "main", phase: "active", hero: false },
      {
        slots: expect.objectContaining({
          views: expect.any(Function),
          widthControls: expect.any(Function),
        }),
      },
    )
    const calls = renderFactorySlot.mock.calls as unknown as [
      string,
      object,
      { slots: { views: (p: { renderSlot: (k: string, o: object) => unknown }) => unknown } },
    ][]
    const views = calls[0]?.[2].slots.views
    const renderSlot = vi.fn(() => null)
    renderToStaticMarkup(createElement(Fragment, null, views?.({ renderSlot }) as ReactNode))
    expect(renderSlot).toHaveBeenCalledWith("conversation.session", { view: "chat" })
  })

  it("keeps the shell with a pending header and inert entries while the bot is not known", () => {
    const html = render(props({ classification: value(pending) }).shellProps)
    expect(html).toContain('data-pending=""')
    expect(html).toContain("shell.loading")
    expect(html).toContain('aria-label="shell.settings.pending"')
    expect(html).toContain("disabled")
    expect(html).toContain('aria-disabled="true"')
    expect(html).not.toContain("Bot x")
    expect(html).not.toContain("data-bot-id")
  })

  it("draws a placeholder instead of the conversation while the opening message is on its way", () => {
    const opening: BotsState = {
      status: "ready",
      snapshot: { bots: [target], pending: [], preparingSessionIds: ["m1"] },
    }
    const { shellProps, renderFactorySlot } = blank({ bots: value(opening) })
    const html = render(shellProps)
    expect(html).toContain('data-phase="hero"')
    expect(html).toContain('data-dshb-shell-preparing=""')
    expect(html).toContain("shell.preparing(Bot x)")
    expect(html).not.toContain("[content]")
    expect(renderFactorySlot).not.toHaveBeenCalled()

    const waiting = blank({ classification: value(pending) })
    expect(render(waiting.shellProps)).toContain("shell.preparing.pending")
    expect(waiting.renderFactorySlot).not.toHaveBeenCalled()

    expect(render(props().shellProps)).not.toContain("shell.preparing")
  })

  it("draws a blank session with no opening on its way as active, so its composer takes input", () => {
    const { shellProps, renderFactorySlot } = blank()
    const html = render(shellProps)
    expect(html).toContain('data-phase="active"')
    expect(html).not.toContain("shell.preparing")
    expect(renderFactorySlot).toHaveBeenCalledWith(
      "conversation.content",
      { variant: "main", phase: "active", hero: false },
      expect.anything(),
    )
  })

  it("keeps the conversation while a session not proven blank replays", () => {
    const { shellProps, renderFactorySlot } = props({
      useSession: (selector) => selector({ blank: true, running: false, openState: "loading" }),
    })
    expect(render(shellProps)).toContain('data-phase="settling"')
    expect(renderFactorySlot).toHaveBeenCalledWith(
      "conversation.content",
      { variant: "main", phase: "settling", hero: false },
      expect.anything(),
    )
  })

  it.each([
    ["failed", { status: "failed", error: "mount" }],
    ["unavailable", { status: "unavailable" }],
  ] satisfies [string, BotsState][])(
    "alerts that bots are unavailable when the list is %s",
    (_name, state) => {
      for (const classification of [known, pending]) {
        const html = render(
          props({ bots: value(state), classification: value(classification) }).shellProps,
        )
        expect(html).toContain('data-dshb-shell-unavailable=""')
        expect(html).toMatch(/role="alert"[^>]*><span[^>]*>shell\.unavailable/)
        expect(html).not.toContain("bots.reconnecting")
      }
    },
  )

  it("says it is reconnecting while the last list stays on screen", () => {
    const state: BotsState = {
      status: "reconnecting",
      snapshot: { bots: [target], pending: [], preparingSessionIds: [] },
    }
    const html = render(props({ bots: value(state) }).shellProps)
    expect(html).toContain('data-dshb-shell-reconnecting=""')
    expect(html).toMatch(/role="status"[^>]*><span[^>]*>bots\.reconnecting/)
    expect(html).not.toContain("shell.unavailable")
    expect(html).toContain("Bot x")
  })

  it("says nothing about the list while it loads or is ready", () => {
    for (const state of [READY, { status: "loading" }] satisfies BotsState[]) {
      const html = render(props({ bots: value(state) }).shellProps)
      expect(html).not.toContain("bots.reconnecting")
      expect(html).not.toContain("shell.unavailable")
    }
  })

  it("shows a failed New session as a dismissible banner", () => {
    const html = render(props({ status: value({ x: { error: "no VM" } }) }).shellProps)
    expect(html).toMatch(
      /data-dshb-shell-banners="">.*data-tone="danger" role="alert" data-dshb-shell-status=""/,
    )
    expect(html).toContain("error.generic(no VM)")
    expect(html).toContain("error.dismiss")
  })

  it("offers the bot's settings screen, not a menu, from the header's settings button", () => {
    const html = render(props().shellProps)
    const button = html.match(/<button[^>]*data-dshb-shell-settings=""[^>]*>/)?.[0]
    expect(button).toContain('aria-haspopup="dialog"')
    expect(button).not.toContain("aria-expanded")
    expect(button).not.toContain("data-context-menu-trigger")
  })

  it("reflects the Files entry's pressed state from the viewer", () => {
    const viewer = createViewer()
    const shellProps = props({
      menu: menuOf(viewer),
      files: filesFace(viewer),
      panels: createSidePanels(viewer),
    }).shellProps
    const pressed = () =>
      render(shellProps).match(
        /data-dshb-shell-entry="bot-core.files"[^>]*aria-pressed="(\w+)"/,
      )?.[1]
    expect(pressed()).toBe("false")
    viewer.toggle("m1")
    expect(pressed()).toBe("true")
  })

  it("puts a refused lockdown before the viewer's notices", () => {
    const viewer = createViewer()
    viewer.notify("m1", "notice.refused.terminal")
    const base = { menu: menuOf(viewer), files: filesFace(viewer) }
    expect(render(props(base).shellProps)).toContain("notice.refused.terminal")
    const refused = render(
      props({
        ...base,
        rightbarRegistration: value<RegistrationStatus>({ state: "refused", error: "taken" }),
      }).shellProps,
    )
    expect(refused).toContain('data-dshb-shell-lockdown-failed=""')
    expect(refused).toContain("notice.lockdownFailed")
    expect(refused).not.toContain("notice.refused.terminal")
  })

  it("draws its notice as a banner over the transcript, outside the header, a dismissed lockdown giving way to the viewer's", () => {
    const viewer = createViewer()
    viewer.notify("m1", "notice.refused.terminal")
    const lockdownNotice = createNoticeDismissal()
    const shell = props({
      menu: menuOf(viewer),
      files: filesFace(viewer),
      lockdownNotice,
      rightbarRegistration: value<RegistrationStatus>({ state: "refused", error: "taken" }),
    }).shellProps
    const banners = (html: string) => {
      expect(html.slice(html.indexOf("<header"), html.indexOf("</header>"))).not.toContain(
        "dshb-shell-banner",
      )
      return html.slice(html.indexOf("data-dshb-shell-banners"))
    }
    const refused = banners(render(shell))
    expect(refused).toMatch(
      /data-tone="warning" role="alert" data-dshb-shell-lockdown-failed="">.*aria-label="error\.dismiss"/,
    )
    lockdownNotice.dismiss()
    const after = banners(render(shell))
    expect(after).not.toContain("notice.lockdownFailed")
    expect(after).toMatch(
      /role="status" data-dshb-shell-notice="">.*notice\.refused\.terminal.*aria-label="error\.dismiss"/,
    )
  })
})

describe("ShellBoundary", () => {
  it("blanks the screen with a notice when it fails, instead of DSH's stock shell", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const boundary = new ShellBoundary({ t, children: "[shell]" })
    expect(renderToStaticMarkup(createElement(Fragment, null, boundary.render()))).toBe("[shell]")
    boundary.state = ShellBoundary.getDerivedStateFromError()
    boundary.componentDidCatch(new Error("boom"))
    const html = renderToStaticMarkup(createElement(Fragment, null, boundary.render()))
    expect(html).toContain('data-dshb-shell-error=""')
    expect(html).toContain('role="alert"')
    expect(html).toContain("shell.error")
    expect(html).not.toContain("[shell]")
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it("names DSH composition errors it swallows", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const boundary = new ShellBoundary({ t, children: null })
    const failure = new Error("not declared")
    failure.name = "SlotAssemblyError"
    boundary.componentDidCatch(failure)
    expect(String(error.mock.calls[0]?.[0])).toContain("SlotAssemblyError")
    error.mockRestore()
  })
})
