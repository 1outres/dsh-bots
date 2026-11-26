import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { BotsSection } from "../src/client/BotsSection"
import type { ActionProps } from "../src/client/face"
import { createStore } from "../src/client/observable"
import type { BotsState, RegistrationStatus } from "../src/client/session-classification"
import { createSessionWindows } from "../src/client/session-window"
import type { SessionListState, SessionSummary, WorkspaceSnapshot } from "../src/client/types"
import { bot, t, value } from "./support/client"
import { fakeSpacesFace } from "./support/spaces-client"

const IDLE: RegistrationStatus = { state: "idle" }

interface Scene {
  readonly sessions?: SessionListState
  readonly workspaces?: WorkspaceSnapshot
  readonly expansion?: Record<string, boolean>
  readonly archivedShown?: Record<string, boolean>
  readonly menuSession?: string
  readonly spaces?: ActionProps["spaces"]
}

function props(state: BotsState, shell = IDLE, rightbar = IDLE, scene: Scene = {}): ActionProps {
  return {
    wide: true,
    t,
    bots: value(state),
    registrations: {
      shell: value(shell),
      rightbar: value(rightbar),
      modelSeat: value(IDLE),
      permissionSeat: value(IDLE),
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
    sessions: value(scene.sessions ?? { phase: "ready" as const, ids: [], byId: {} }),
    workspaces: value(
      scene.workspaces ?? { phase: "ready" as const, items: [], archivedSessionIds: [] },
    ),
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
    expansion: Object.assign(value(scene.expansion ?? {}), { set() {} }),
    setExpanded() {},
    archivedView: Object.assign(value(scene.archivedShown ?? {}), { set() {} }),
    setArchivedShown() {},
    startNewMain() {},
    windows: createSessionWindows(),
    archive: { archive() {}, unarchive() {} },
    menuBot: value(undefined),
    menuOpener: value(undefined),
    openBotMenu() {},
    menuSession: value(scene.menuSession),
    openSessionMenu() {},
    spaces: scene.spaces ?? fakeSpacesFace(),
  }
}

function render(state: BotsState, shell = IDLE, rightbar = IDLE, scene: Scene = {}): string {
  return renderToStaticMarkup(createElement(BotsSection, props(state, shell, rightbar, scene)))
}

const listed = { bots: [bot("x", "m1")], pending: [], preparingSessionIds: [] }

describe("BotsSection", () => {
  it("lists the bots when ready, and says so when there are none", () => {
    const html = render({ status: "ready", snapshot: listed })
    expect(html).toContain('role="tree"')
    expect(html).toContain("Bot x")
    expect(html).not.toContain("bots.reconnecting")
    expect(
      render({ status: "ready", snapshot: { bots: [], pending: [], preparingSessionIds: [] } }),
    ).toContain("section.empty")
  })

  it("keeps the last list on screen while reconnecting, with a reconnecting note", () => {
    const html = render({ status: "reconnecting", snapshot: listed })
    expect(html).toContain("Bot x")
    expect(html).toContain("data-dshb-reconnecting")
    expect(html).toContain("bots.reconnecting")
  })

  it("shows loading, unavailable and failed without a tree", () => {
    expect(render({ status: "loading" })).toContain("section.loading")
    const unavailable = render({ status: "unavailable", error: "watch: closed" })
    expect(unavailable).toContain("section.unavailable")
    expect(unavailable).toContain("watch: closed")
    expect(unavailable).toMatch(/data-dshb-new-bot=""[^>]*disabled|disabled[^>]*data-dshb-new-bot/)
    const failed = render({ status: "failed", error: "no typert" })
    expect(failed).toContain('role="alert"')
    expect(failed).toContain("section.failed")
    expect(failed).not.toContain('role="tree"')
  })

  it("offers the dsh-bots settings from its header, whatever the bots' state", () => {
    for (const state of [
      { status: "ready", snapshot: listed },
      { status: "unavailable" },
      { status: "failed", error: "no typert" },
    ] satisfies BotsState[]) {
      const html = render(state)
      expect(html).toMatch(
        /<button type="button" class="dshb-icon-button" title="section.globalSettings" aria-label="section.globalSettings" aria-haspopup="dialog" data-dshb-global-settings-open="">/,
      )
    }
  })

  it("marks the dsh-bots settings button with the settings' attention", () => {
    const html = renderToStaticMarkup(
      createElement(BotsSection, {
        ...props({ status: "ready", snapshot: listed }),
        globalSettingsAttention: value({ tone: "warning" as const, label: () => "key missing" }),
      }),
    )
    expect(html).toMatch(
      /aria-label="section.globalSettings: key missing"[^>]*data-dshb-global-settings-open="" data-dshb-global-settings-attention="warning"/,
    )
  })

  it("shows each refused registration as an alert with its cause", () => {
    expect(render({ status: "loading" })).not.toContain("registration.refused")
    const html = render(
      { status: "ready", snapshot: listed },
      { state: "refused", error: "taken at -100" },
      { state: "active" },
    )
    expect(html).toContain('data-dshb-registration-refused="shell"')
    expect(html).toContain("registration.refused.shell")
    expect(html).toContain("taken at -100")
    expect(html).not.toContain("registration.refused.rightbar")
  })
})

const summary = (id: string, extra: Partial<SessionSummary> = {}): SessionSummary => ({
  id,
  displayTitle: id,
  title: `Title ${id}`,
  running: false,
  blank: false,
  updatedAt: 0,
  ...extra,
})

const listOf = (rows: SessionSummary[]): SessionListState => ({
  phase: "ready",
  ids: rows.map((row) => row.id),
  byId: Object.fromEntries(rows.map((row) => [row.id, row])),
})

describe("BotsSection sessions", () => {
  const ids = Array.from({ length: 8 }, (_, index) => `s${index + 1}`)
  const many = { bots: [bot("x", "m1", ids)], pending: [], preparingSessionIds: [] }
  const sessions = listOf([summary("m1"), ...ids.map((id) => summary(id))])
  const keysOf = (html: string) =>
    [...html.matchAll(/data-dshb-key="([^"]+)"/g)].map((match) => match[1])

  it("lists Main, then the newest sessions, then Show more at the bottom", () => {
    const html = render({ status: "ready", snapshot: many }, IDLE, IDLE, {
      sessions,
      expansion: { x: true },
    })
    expect(keysOf(html)).toEqual([
      "bot:x",
      "session:m1",
      "session:s8",
      "session:s7",
      "session:s6",
      "session:s5",
      "session:s4",
      "overflow:x",
    ])
    expect(html).toContain("sessions.expand.other(3)")
    expect(html).toMatch(
      /aria-posinset="7"[^>]*data-dshb-key="overflow:x"[^>]*data-dshb-overflow="more"/,
    )
    expect(html).toContain('aria-setsize="7"')
    expect(html).toContain('data-dshb-archive-toggle="archive"')
    expect(html).toContain('aria-label="session.archive.aria(Title s8)"')
  })

  it("shows archived sessions grayed in place with Unarchive while the bot lists them", () => {
    const html = render({ status: "ready", snapshot: many }, IDLE, IDLE, {
      sessions,
      workspaces: { phase: "ready", items: [], archivedSessionIds: ["s8", "s2"] },
      expansion: { x: true },
      archivedShown: { x: true },
    })
    expect(keysOf(html).slice(2, 4)).toEqual(["session:s8", "session:s7"])
    expect(html).toMatch(/data-dshb-key="session:s8"[^>]*data-archived=""/)
    expect(html).toContain('aria-description="session.archived.hint"')
    expect(html).toContain('data-dshb-archive-toggle="unarchive"')
    expect(html).toContain("sessions.expand.other(3)")
  })

  it("leaves archived sessions out by default, and gives Main no archive action", () => {
    const html = render({ status: "ready", snapshot: many }, IDLE, IDLE, {
      sessions,
      workspaces: { phase: "ready", items: [], archivedSessionIds: ["s8", "s7", "s6"] },
      expansion: { x: true },
    })
    expect(keysOf(html)).toEqual([
      "bot:x",
      "session:m1",
      "session:s5",
      "session:s4",
      "session:s3",
      "session:s2",
      "session:s1",
    ])
    expect(html).not.toContain("data-archived")
    expect(html.match(/data-dshb-archive-toggle/g)).toHaveLength(5)
  })

  it("marks the session whose menu is open", () => {
    const html = render({ status: "ready", snapshot: many }, IDLE, IDLE, {
      sessions,
      expansion: { x: true },
      menuSession: "s7",
    })
    expect(html).toMatch(/data-dshb-key="session:s7"[^>]*data-menu-open=""/)
  })
})
