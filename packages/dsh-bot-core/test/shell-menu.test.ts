import { describe, expect, it, vi } from "vitest"
import type { ActionsHub } from "../src/client/approvals/hub"
import type { ConnectorsHub } from "../src/client/connectors-hub"
import { ACTIONS_PANEL, createSidePanels } from "../src/client/shell/side-panels"
import { builtinShellEntries, createShellMenu, type ShellMenuEntry } from "../src/client/shell-menu"
import { createViewer } from "../src/client/viewer"
import type { ConnectorActionView } from "../src/shared/connectors"
import { bot, idleApprovals, idleConnectorPanels, t, value } from "./support/client"
import { probeView } from "./support/connectors-client"

const plainView = probeView()
const idleView = {
  ...plainView,
  connector: {
    ...plainView.connector,
    panel: { title: { en: "Desktop" }, icon: "desktop" as const, streams: [] },
  },
}

const sources = (viewer = createViewer()) => ({
  viewer,
  panels: createSidePanels(viewer),
  approvals: idleApprovals,
  connectors: idleConnectorPanels.connectors,
})

describe("shell menu", () => {
  const entry = (id: string, order: number): ShellMenuEntry => ({
    id,
    order,
    label: () => id,
    icon: () => null,
    run: () => {},
  })

  it("lists entries by order, then id, and removes them with their disposer", () => {
    const menu = createShellMenu()
    const listener = vi.fn()
    menu.subscribe(listener)
    const offB = menu.register(entry("b", 10))
    menu.register(entry("a", 10))
    menu.register(entry("first", 1))
    expect(menu.getSnapshot().map((item) => item.id)).toEqual(["first", "a", "b"])
    offB()
    offB()
    expect(menu.getSnapshot().map((item) => item.id)).toEqual(["first", "a"])
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it("refuses a second entry with the same id", () => {
    const menu = createShellMenu()
    menu.register(entry("a", 1))
    expect(() => menu.register(entry("a", 2))).toThrow(/already registered/)
  })

  it("offers the bot's files and actions: settings live in the header, new sessions in the sidebar", () => {
    const viewer = createViewer()
    const target = bot("x", "m1")
    const anchor = {} as HTMLElement
    const entries = builtinShellEntries(sources(viewer)).filter(
      (item) => item.id === "bot-core.files",
    )
    expect(builtinShellEntries(sources(viewer)).map((item) => item.id)).toEqual([
      "bot-core.files",
      "bot-core.notes",
      "bot-core.actions",
    ])
    expect(entries.map((item) => item.label(t, target))).toEqual(["shell.files(Bot x)"])
    const context = { bot: target, sessionId: "m1" }
    const files = entries.find((item) => item.id === "bot-core.files")
    const pressed = files?.pressed?.(context)
    const heard = vi.fn()
    pressed?.subscribe(heard)
    expect(pressed?.getSnapshot()).toBe(false)
    for (const item of entries) item.run(context, anchor)
    // Files toggles the session's viewer and pushes its pressed state.
    expect(viewer.of("m1").open).toBe(true)
    expect(pressed?.getSnapshot()).toBe(true)
    expect(heard).toHaveBeenCalledTimes(1)
    files?.run(context, anchor)
    expect(viewer.of("m1").open).toBe(false)
    expect(heard).toHaveBeenCalledTimes(2)
    // Another session's viewer does not touch it.
    viewer.toggle("m2")
    expect(heard).toHaveBeenCalledTimes(2)
  })

  it("declares no disabled state for its entries", () => {
    const entries = builtinShellEntries(sources())
    expect(entries.filter((item) => item.pressed !== undefined).map((item) => item.id)).toEqual([
      "bot-core.files",
      "bot-core.notes",
      "bot-core.actions",
    ])
    expect(entries.every((item) => item.disabled === undefined)).toBe(true)
  })

  it("toggles the Actions panel, counts the pending actions and marks a connector's request", () => {
    const viewer = createViewer()
    const panels = createSidePanels(viewer)
    const pending = (id: string): ConnectorActionView => ({
      id,
      botId: "x",
      connector: { id: "mail", name: "Mail" },
      tool: "send",
      toolName: "mail_send",
      args: {},
      preview: { title: "Send?", fields: [] },
      createdAt: 1,
      expiresAt: 2,
      status: { state: "pending" },
    })
    const actions = value({
      status: "ready" as const,
      actions: [pending("a"), pending("b")],
      reconnecting: false,
    })
    const approvals: ActionsHub = {
      feed: () => ({ ...actions, decide: idleApprovals.feed("x").decide }),
    }
    const requested = value({
      status: "ready" as const,
      snapshot: {
        botId: "x",
        connectors: [
          {
            ...idleView,
            status: { request: { id: "r", reason: "log in", since: 1 } },
          },
        ],
      },
    })
    const connectors: ConnectorsHub = {
      feed: () => ({ ...idleConnectorPanels.connectors.feed("x"), ...requested }),
    }
    const entry = builtinShellEntries({ viewer, panels, approvals, connectors }).find(
      (item) => item.id === "bot-core.actions",
    )
    if (entry === undefined) throw new Error("no Actions entry")
    const context = { bot: bot("x", "m1"), sessionId: "m1" }
    expect(entry.label(t, context.bot)).toBe("shell.actions(Bot x)")
    expect(entry.count?.(context).getSnapshot()).toBe(2)
    expect(entry.attention?.(context).getSnapshot()).toBe(true)
    const pressed = entry.pressed?.(context)
    expect(pressed?.getSnapshot()).toBe(false)
    entry.run(context, {} as HTMLElement)
    expect(panels.of("m1")).toEqual(ACTIONS_PANEL)
    expect(pressed?.getSnapshot()).toBe(true)
    entry.run(context, {} as HTMLElement)
    expect(panels.of("m1")).toBeUndefined()
  })
})
