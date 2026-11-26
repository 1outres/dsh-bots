import { describe, expect, it, vi } from "vitest"
import {
  botMenuActions,
  botMenuTarget,
  createBotMenuOpener,
  hasArchivedSessions,
  menuTargetBotId,
  rowMenuOpener,
} from "../src/client/menu"
import type { MenuTarget } from "../src/client/types"
import type { BotView } from "../src/shared/bots"
import { value } from "./support/client"

const bot: BotView = {
  id: "a",
  name: "Alice",
  avatar: { kind: "emoji", emoji: "🤖", color: "#6366F1" },
  mainSessionId: "m-a",
  mainStartedAt: 0,
  timezone: "UTC",
  sessionIds: [],
  formerMainIds: [],
  createdAt: 0,
}

const t = (key: string) => key

function face() {
  return {
    newSession: vi.fn(),
    openSettings: vi.fn(),
    confirmDelete: vi.fn(),
    setArchivedShown: vi.fn(),
    startNewMain: vi.fn(),
  }
}

describe("bot menu", () => {
  it("round-trips the target's bot id and ignores other targets", () => {
    expect(menuTargetBotId(botMenuTarget(bot))).toBe("a")
    expect(menuTargetBotId({ kind: "session", value: { sessionId: "x" } })).toBeUndefined()
    expect(menuTargetBotId(null)).toBeUndefined()
  })

  it("lists new session, the archived toggle, settings and a separated danger delete", () => {
    const actions = botMenuActions(bot, { shown: false, any: true }, face(), t)
    expect(actions.map((action) => action.id)).toEqual([
      "new-session",
      "new-main",
      "archived",
      "settings",
      "delete",
    ])
    expect(actions.map((action) => action.label)).toEqual([
      "bot.newSession",
      "menu.newMain",
      "menu.showArchived",
      "menu.settings",
      "menu.delete",
    ])
    const remove = actions.find((action) => action.id === "delete")
    expect(remove?.danger).toBe(true)
    expect(remove?.separatorBefore).toBe(true)
  })

  it("starts sessions, toggles the archived sessions, opens the settings and asks to confirm Delete", () => {
    const f = face()
    for (const action of botMenuActions(bot, { shown: false, any: true }, f, t)) void action.run?.()
    expect(f.newSession).toHaveBeenCalledWith(bot)
    expect(f.setArchivedShown).toHaveBeenCalledWith("a", true)
    expect(f.openSettings.mock.calls).toEqual([["a"]])
    expect(f.confirmDelete).toHaveBeenCalledWith("a")
  })

  it("offers to hide the archived sessions while they are shown", () => {
    const f = face()
    const toggle = botMenuActions(bot, { shown: true, any: false }, f, t).find(
      (action) => action.id === "archived",
    )
    expect(toggle?.label).toBe("menu.hideArchived")
    expect(toggle?.icon).toEqual({ key: "bot-core.hide-archived" })
    void toggle?.run?.()
    expect(f.setArchivedShown).toHaveBeenCalledWith("a", false)
  })

  it("leaves out Show archived sessions while the bot has none", () => {
    const ids = botMenuActions(bot, { shown: false, any: false }, face(), t).map(
      (action) => action.id,
    )
    expect(ids).toEqual(["new-session", "new-main", "settings", "delete"])
  })

  it("finds archived sessions among the bot's own", () => {
    const owned = { ...bot, sessionIds: ["s1", "s2"] }
    const snapshot = (archivedSessionIds: string[]) => ({
      phase: "ready" as const,
      items: [],
      archivedSessionIds,
    })
    expect(hasArchivedSessions(owned, snapshot(["s2"]))).toBe(true)
    expect(hasArchivedSessions(owned, snapshot(["other"]))).toBe(false)
  })
})
function menus() {
  const active = value<MenuTarget | null>(null)
  return {
    active,
    open: vi.fn((target: MenuTarget) => active.set(target)),
    close: vi.fn(() => active.set(null)),
  }
}

const shellOpener = "bot-core:other:a"

describe("bot menu opener", () => {
  const other: BotView = { ...bot, id: "b", mainSessionId: "m-b" }

  it("records the opener a button passes and closes on its second activation", () => {
    const fake = menus()
    const opener = createBotMenuOpener(fake)
    const shell = shellOpener
    opener.openBotMenu(bot, { x: 1, y: 2 }, shell)
    expect(fake.open).toHaveBeenCalledWith(botMenuTarget(bot), { x: 1, y: 2 }, { button: shell })
    expect(opener.menuBot.getSnapshot()).toBe("a")
    expect(opener.menuOpener.getSnapshot()).toBe(shell)

    opener.openBotMenu(bot, { x: 1, y: 2 }, shell)
    expect(fake.close).toHaveBeenCalledTimes(1)
    expect(opener.menuOpener.getSnapshot()).toBeUndefined()
    opener.dispose()
  })

  it("tells the shell's button from the row's and from a gesture on the same bot", () => {
    const fake = menus()
    const opener = createBotMenuOpener(fake)
    opener.openBotMenu(bot, { x: 0, y: 0 }, shellOpener)
    opener.openBotMenu(bot, { x: 0, y: 0 }, rowMenuOpener("a"))
    expect(fake.close).not.toHaveBeenCalled()
    expect(opener.menuOpener.getSnapshot()).toBe(rowMenuOpener("a"))
    opener.openBotMenu(bot, { x: 5, y: 5 }, undefined)
    expect(fake.open).toHaveBeenLastCalledWith(botMenuTarget(bot), { x: 5, y: 5 })
    expect(opener.menuBot.getSnapshot()).toBe("a")
    expect(opener.menuOpener.getSnapshot()).toBeUndefined()
    opener.dispose()
  })

  it("drops the opener once its bot's menu is dismissed or replaced", () => {
    const fake = menus()
    const opener = createBotMenuOpener(fake)
    opener.openBotMenu(bot, { x: 0, y: 0 }, rowMenuOpener("a"))
    fake.active.set(null)
    expect(opener.menuOpener.getSnapshot()).toBeUndefined()
    opener.openBotMenu(bot, { x: 0, y: 0 }, rowMenuOpener("a"))
    expect(fake.close).not.toHaveBeenCalled()
    fake.active.set(botMenuTarget(other))
    fake.active.set(botMenuTarget(bot))
    expect(opener.menuOpener.getSnapshot()).toBeUndefined()
    opener.dispose()
  })
})
