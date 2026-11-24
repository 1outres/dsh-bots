import { describe, expect, it, vi } from "vitest"
import {
  botSessionMenuActions,
  botSessionMenuTarget,
  createSessionMenuOpener,
  menuTargetSessionId,
} from "../src/client/session-menu"
import type { MenuTarget } from "../src/client/types"
import { bot, t, value } from "./support/client"

const session = { bot: bot("a", "m-a", ["s1"]), sessionId: "s1", title: "Plans" }

describe("bot session menu", () => {
  it("names its own target family, apart from bots and DSH's sessions", () => {
    const target = botSessionMenuTarget(session)
    expect(target).toEqual({
      kind: "bot-session",
      value: { botId: "a", sessionId: "s1", displayTitle: "Plans" },
    })
    expect(menuTargetSessionId(target)).toBe("s1")
    expect(menuTargetSessionId({ kind: "session", value: { sessionId: "s1" } })).toBeUndefined()
    expect(menuTargetSessionId({ kind: "bot", value: { botId: "a" } })).toBeUndefined()
    expect(menuTargetSessionId(null)).toBeUndefined()
  })

  it("offers Archive, or Unarchive for an archived session", () => {
    const archive = { archive: vi.fn(), unarchive: vi.fn() }
    const [toArchive] = botSessionMenuActions(session, false, archive, t)
    expect(toArchive).toMatchObject({
      id: "archive",
      label: "session.archive",
      icon: { key: "bot-core.archive" },
    })
    void toArchive?.run?.()
    expect(archive.archive).toHaveBeenCalledWith(session)
    const [toRestore] = botSessionMenuActions(session, true, archive, t)
    expect(toRestore).toMatchObject({ id: "unarchive", label: "session.unarchive" })
    void toRestore?.run?.()
    expect(archive.unarchive).toHaveBeenCalledWith("a", "s1")
  })

  it("follows which session's menu is open", () => {
    const active = value<MenuTarget | null>(null)
    const open = vi.fn((target: MenuTarget) => active.set(target))
    const opener = createSessionMenuOpener({ active, open })
    expect(opener.menuSession.getSnapshot()).toBeUndefined()
    opener.openSessionMenu(session, { x: 3, y: 4 })
    expect(open).toHaveBeenCalledWith(botSessionMenuTarget(session), { x: 3, y: 4 })
    expect(opener.menuSession.getSnapshot()).toBe("s1")
    active.set(null)
    expect(opener.menuSession.getSnapshot()).toBeUndefined()
  })
})
