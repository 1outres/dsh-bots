import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { BotNoticeToast } from "../src/client/BotNoticeToast"
import { creationSteps, elapsedText, lifecycleEvents, pendingOf } from "../src/client/lifecycle"
import { createNoticeStore } from "../src/client/notices"
import { PendingBotRow, pendingLabel } from "../src/client/PendingBotRow"
import type { BotsState } from "../src/client/session-classification"
import { CreationProgress } from "../src/client/shell/CreationProgress"
import { pendingKey } from "../src/client/tree"
import type { BotsSnapshot, PendingBotView } from "../src/shared/bots"
import { bot, creating, t, value } from "./support/client"

const failed = (pending: PendingBotView, message = "boom", at = 9): PendingBotView => ({
  ...pending,
  failure: { message, at },
})
const removing = (id: string): PendingBotView => ({
  ...creating(id, ["m"]),
  operation: { kind: "remove" },
})
const snapshot = (pending: PendingBotView[], bots = [bot("listed", "m0")]): BotsSnapshot => ({
  bots,
  pending,
  preparingSessionIds: [],
})
const actions = () => {
  const calls: string[] = []
  return {
    calls,
    pending: {
      retryCreate: (id: string) => calls.push(`retryCreate ${id}`),
      discardCreate: (id: string) => calls.push(`discardCreate ${id}`),
      retryRemove: (id: string) => calls.push(`retryRemove ${id}`),
      dismissRemove: (id: string) => calls.push(`dismissRemove ${id}`),
    },
  }
}

describe("lifecycleEvents", () => {
  it("reports a creation that became a bot, failures once, and pending bots that left", () => {
    const before = snapshot([creating("a"), creating("b"), removing("c"), creating("d")])
    const after = snapshot(
      [failed(creating("b")), failed(removing("c")), creating("e")],
      [bot("a", "ma")],
    )
    expect(lifecycleEvents(before, after)).toEqual([
      { kind: "create-failed", pending: failed(creating("b")) },
      { kind: "remove-failed", pending: failed(removing("c")) },
      { kind: "created", bot: bot("a", "ma") },
      { kind: "gone", id: "d", operation: "create" },
    ])
    expect(lifecycleEvents(after, after)).toEqual([])
    // Failing again without a retry in between is no news; after a retry it is.
    expect(lifecycleEvents(after, snapshot([failed(creating("b"), "again", 20)]))).toEqual([
      { kind: "gone", id: "c", operation: "remove" },
      { kind: "gone", id: "e", operation: "create" },
    ])
    const retried = snapshot([creating("b")])
    expect(lifecycleEvents(retried, snapshot([failed(creating("b"), "again", 20)]))).toEqual([
      { kind: "create-failed", pending: failed(creating("b"), "again", 20) },
    ])
  })

  it("finds a pending bot", () => {
    expect(pendingOf(snapshot([creating("a")]), "a")?.id).toBe("a")
    expect(pendingOf(snapshot([creating("a")]), "b")).toBeUndefined()
  })
})

describe("creationSteps / elapsedText", () => {
  it("marks the steps before the current one done and the later ones waiting", () => {
    expect(creationSteps("booting", false).map((step) => step.state)).toEqual([
      "done",
      "done",
      "current",
      "waiting",
      "waiting",
      "waiting",
    ])
    expect(creationSteps("queued", true)[0]).toEqual({ phase: "queued", state: "failed" })
  })

  it("formats minutes and seconds, then hours", () => {
    expect(elapsedText(0)).toBe("0:00")
    expect(elapsedText(65_400)).toBe("1:05")
    expect(elapsedText(3_726_000)).toBe("1:02:06")
    expect(elapsedText(-5)).toBe("0:00")
  })
})

describe("PendingBotRow", () => {
  const render = (pending: PendingBotView, status = {}) => {
    const { calls, pending: actionsOf } = actions()
    const html = renderToStaticMarkup(
      createElement(PendingBotRow, {
        t,
        node: { kind: "pending", pending, key: pendingKey(pending.id), selected: false },
        tabKey: pendingKey(pending.id),
        index: 0,
        count: 1,
        pending: actionsOf,
        openProgress() {},
        status: value(status),
        clearError() {},
      }),
    )
    return { html, calls }
  }

  it("shows a creation's step with a spinner, busy, and no actions", () => {
    const { html } = render(creating("a", [], "creating"))
    expect(html).toContain('data-dshb-pending="create"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain("phase.creating")
    expect(html).toContain("dshb-spinner")
    expect(html).not.toContain("pending.retry")
  })

  it("shows a failed creation with retry, discard and its details folded", () => {
    const { html } = render(failed(creating("a")))
    expect(html).toContain("data-failed")
    expect(html).toContain("pending.createFailed")
    expect(html).toContain("pending.retry")
    expect(html).toContain("pending.discard")
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain("boom")
  })

  it("shows a removal as deleting, inert, and a failed one with retry and close", () => {
    expect(render(removing("a")).html).toContain("pending.removing")
    expect(render(removing("a")).html).toContain("data-inert")
    const { html } = render(failed(removing("a")))
    expect(html).toContain("pending.removeFailed")
    expect(html).toContain("pending.dismiss")
  })

  it("shows a refused request on the row", () => {
    expect(render(creating("a"), { a: { error: "gone" } }).html).toContain("error.generic(gone)")
  })

  it("labels every state", () => {
    expect(pendingLabel(creating("a", [], "starting-main"))).toBe("phase.starting-main")
    expect(pendingLabel(failed(creating("a")))).toBe("pending.createFailed")
    expect(pendingLabel(removing("a"))).toBe("pending.removing")
    expect(pendingLabel(failed(removing("a")))).toBe("pending.removeFailed")
  })
})

describe("CreationProgress", () => {
  const render = (state: BotsState, botId = "a") =>
    renderToStaticMarkup(
      createElement(CreationProgress, { t, bots: value(state), pending: actions().pending, botId }),
    )

  it("lists the steps with the current one marked, and the elapsed time", () => {
    const html = render({ status: "ready", snapshot: snapshot([creating("a", [], "connecting")]) })
    expect(html).toContain("progress.title(Bot a)")
    expect(html).toContain('data-state="done"')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain("step.connecting")
    expect(html).toContain("progress.elapsed(")
    expect(html).not.toContain("dshb-hint")
  })

  it("shows a failure with its message, its time frozen, and retry and discard", () => {
    const html = render({
      status: "ready",
      snapshot: snapshot([failed({ ...creating("a", [], "preset"), startedAt: 0 }, "bad", 61_000)]),
    })
    expect(html).toContain("progress.failedTitle(Bot a)")
    expect(html).toContain('data-state="failed"')
    expect(html).toContain("progress.elapsed(1:01)")
    expect(html).toContain('role="alert"')
    expect(html).toContain("bad")
    expect(html).toContain("pending.retry")
    expect(html).toContain("pending.discard")
  })

  it("is a neutral placeholder for a bot that is not being created", () => {
    expect(render({ status: "loading" })).toContain("shell.classifying")
    expect(render({ status: "ready", snapshot: snapshot([removing("a")]) })).toContain(
      "shell.classifying",
    )
  })
})

describe("notices", () => {
  const actions = { undoArchive: vi.fn(), showArchived: vi.fn() }
  it("shows the latest notice and dismisses only the one asked for", () => {
    const notices = createNoticeStore()
    notices.show({ kind: "created", name: "A" })
    const first = notices.getSnapshot()?.seq ?? 0
    notices.show({ kind: "create-failed", name: "B" })
    notices.dismiss(first)
    expect(notices.getSnapshot()?.notice).toEqual({ kind: "create-failed", name: "B" })
    const html = renderToStaticMarkup(createElement(BotNoticeToast, { t, notices, actions }))
    expect(html).toContain('role="alert"')
    expect(html).toContain("toast.createFailed(B)")
    notices.dismiss(notices.getSnapshot()?.seq ?? 0)
    expect(notices.getSnapshot()).toBeNull()
    expect(renderToStaticMarkup(createElement(BotNoticeToast, { t, notices, actions }))).toBe("")
  })
})
