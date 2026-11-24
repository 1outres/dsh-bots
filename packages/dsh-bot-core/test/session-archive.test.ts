import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { ArchiveConfirmDialog, activityLine } from "../src/client/ArchiveConfirmDialog"
import { BotNoticeToast } from "../src/client/BotNoticeToast"
import { createNoticeStore } from "../src/client/notices"
import { activeSessionRefusal, createSessionArchive } from "../src/client/session-archive"
import { createStatusStore } from "../src/client/status"
import type { SessionListState } from "../src/client/types"
import { bot, t, value } from "./support/client"

class WorkspaceArchiveError extends Error {
  override readonly name = "WorkspaceArchiveError"
  constructor(readonly rpcError: { code: string; message: string; details?: object }) {
    super(rpcError.message)
  }
}

const running = new WorkspaceArchiveError({
  code: "workspace/session-active",
  message: "still running",
  details: { sessionId: "s1", activity: [{ kind: "turn" }] },
})

const listShowing = (shown: string | undefined): SessionListState => ({
  phase: "ready",
  ids: ["m-a", "s1", "s2"],
  byId: Object.fromEntries(
    ["m-a", "s1", "s2"].map((id) => [
      id,
      {
        id,
        displayTitle: id,
        running: false,
        blank: false,
        updatedAt: 0,
        retainedBy: { mainView: id === shown ? 1 : 0 },
      },
    ]),
  ),
})

function setup(shown: string | undefined = undefined) {
  const sessions = value(listShowing(shown))
  const workspace = {
    archiveSession: vi.fn(async (_id: string, _options?: { stopActivity?: boolean }) => {}),
    unarchiveSession: vi.fn(async (_id: string) => {}),
    openSession: vi.fn((_id: string) => {}),
  }
  const status = createStatusStore()
  const notices = createNoticeStore()
  const archive = createSessionArchive({ workspace, sessions, status, notices })
  const a = bot("a", "m-a", ["s1", "s2"])
  return { sessions, workspace, status, notices, archive, a }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("activeSessionRefusal", () => {
  it("reads the work a session-active refusal names, and nothing else", () => {
    expect(activeSessionRefusal(running)).toEqual([{ kind: "turn" }])
    expect(
      activeSessionRefusal(
        new WorkspaceArchiveError({ code: "workspace/not-found", message: "x" }),
      ),
    ).toBeUndefined()
    expect(activeSessionRefusal(new Error("boom"))).toBeUndefined()
    expect(activeSessionRefusal("boom")).toBeUndefined()
  })
})

describe("createSessionArchive", () => {
  it("archives a session in the background and offers Undo in a notice", async () => {
    const { workspace, notices, archive, a } = setup()
    archive.archive({ bot: a, sessionId: "s1", title: "Plans" })
    await flush()
    expect(workspace.archiveSession).toHaveBeenCalledWith("s1")
    expect(workspace.openSession).not.toHaveBeenCalled()
    expect(notices.getSnapshot()?.notice).toEqual({
      kind: "session-archived",
      botId: "a",
      sessionId: "s1",
    })
  })

  it("goes back to the bot's Main when the archived session was shown", async () => {
    const { sessions, workspace, archive, a } = setup("s1")
    workspace.archiveSession.mockImplementation(async () => sessions.set(listShowing(undefined)))
    archive.archive({ bot: a, sessionId: "s1", title: "Plans" })
    await flush()
    expect(workspace.openSession).toHaveBeenCalledWith("m-a")
  })

  it("stays where the user went meanwhile", async () => {
    const { sessions, workspace, archive, a } = setup("s1")
    workspace.archiveSession.mockImplementation(async () => sessions.set(listShowing("s2")))
    archive.archive({ bot: a, sessionId: "s1", title: "Plans" })
    await flush()
    expect(workspace.openSession).not.toHaveBeenCalled()
  })

  it("asks before stopping running work, then stops and archives", async () => {
    const { workspace, archive, a, notices } = setup()
    workspace.archiveSession.mockRejectedValueOnce(running)
    const session = { bot: a, sessionId: "s1", title: "Plans" }
    archive.archive(session)
    await flush()
    const request = archive.confirming.getSnapshot()
    expect(request).toEqual({ session, activity: [{ kind: "turn" }] })
    expect(notices.getSnapshot()).toBeNull()
    if (request === null) throw new Error("no confirmation")
    await archive.stopAndArchive(request)
    expect(workspace.archiveSession).toHaveBeenLastCalledWith("s1", { stopActivity: true })
    expect(archive.confirming.getSnapshot()).toBeNull()
    expect(notices.getSnapshot()?.notice.kind).toBe("session-archived")
  })

  it("keeps the confirmation open when stopping fails, and closes it on settle", async () => {
    const { workspace, archive, a } = setup()
    workspace.archiveSession.mockRejectedValueOnce(running)
    archive.archive({ bot: a, sessionId: "s1", title: "Plans" })
    await flush()
    const request = archive.confirming.getSnapshot()
    if (request === null) throw new Error("no confirmation")
    workspace.archiveSession.mockRejectedValueOnce(new Error("stop failed"))
    await expect(archive.stopAndArchive(request)).rejects.toThrow("stop failed")
    expect(archive.confirming.getSnapshot()).toBe(request)
    archive.settle()
    expect(archive.confirming.getSnapshot()).toBeNull()
  })

  it("shows other refusals on the bot's row, and clears them once an action succeeds", async () => {
    const { workspace, status, archive, a } = setup()
    workspace.archiveSession.mockRejectedValueOnce(new Error("no such session"))
    archive.archive({ bot: a, sessionId: "s1", title: "Plans" })
    await flush()
    expect(status.get("a")).toEqual({ error: "no such session" })
    expect(archive.confirming.getSnapshot()).toBeNull()
    workspace.unarchiveSession.mockRejectedValueOnce(new Error("refused"))
    archive.unarchive("a", "s2")
    await flush()
    expect(status.get("a")).toEqual({ error: "refused" })
    archive.unarchive("a", "s2")
    await flush()
    expect(workspace.unarchiveSession).toHaveBeenLastCalledWith("s2")
    expect(status.get("a")).toBeUndefined()
  })
})

describe("ArchiveConfirmDialog", () => {
  it("renders nothing until asked, then names the session and the work to stop", async () => {
    const { workspace, archive, a } = setup()
    const render = () => renderToStaticMarkup(createElement(ArchiveConfirmDialog, { t, archive }))
    expect(render()).toBe("")
    workspace.archiveSession.mockRejectedValueOnce(running)
    archive.archive({ bot: a, sessionId: "s1", title: "Plans" })
    await flush()
    const html = render()
    expect(html).toContain('role="alertdialog"')
    expect(html).toContain("archive.confirm.description(Plans)")
    expect(html).toContain("<li>archive.confirm.turn</li>")
    expect(html).toContain("archive.confirm.action")
  })

  it("words each family of work, one or many, and families it does not know", () => {
    const items = (...labels: string[]) => labels.map((label) => ({ id: `id-${label}`, label }))
    expect(activityLine({ kind: "job", items: items("build") }, t)).toBe(
      "archive.confirm.jobs.one(1,build)",
    )
    expect(activityLine({ kind: "subagent", items: items("a", "b") }, t)).toBe(
      "archive.confirm.subagents.other(2,aarchive.confirm.separatorb)",
    )
    expect(activityLine({ kind: "schedule", items: [{ id: "x" }] }, t)).toBe(
      "archive.confirm.schedules.one(1,x)",
    )
    expect(activityLine({ kind: "watcher", items: items("w", "v") }, t)).toBe(
      "archive.confirm.other.other(2,watcher)",
    )
  })
})

describe("BotNoticeToast for sessions", () => {
  it("offers Undo and Show archived after an archive", () => {
    const notices = createNoticeStore()
    const actions = { undoArchive: vi.fn(), showArchived: vi.fn() }
    notices.show({ kind: "session-archived", botId: "a", sessionId: "s1" })
    const html = renderToStaticMarkup(createElement(BotNoticeToast, { t, notices, actions }))
    expect(html).toContain('role="status"')
    expect(html).toContain('data-tone="info"')
    expect(html).toContain("toast.sessionArchived")
    expect(html).toContain('data-dshb-notice-action="undo"')
    expect(html).toContain('data-dshb-notice-action="show-archived"')
  })

  it("warns that an archived session does not open", () => {
    const notices = createNoticeStore()
    notices.show({ kind: "archived-not-openable" })
    const html = renderToStaticMarkup(
      createElement(BotNoticeToast, {
        t,
        notices,
        actions: { undoArchive: vi.fn(), showArchived: vi.fn() },
      }),
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('data-tone="warning"')
    expect(html).toContain("session.archived.hint")
    expect(html).not.toContain("data-dshb-notice-action")
  })
})
