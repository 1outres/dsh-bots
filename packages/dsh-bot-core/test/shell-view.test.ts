import { describe, expect, it } from "vitest"
import type {
  BotsState,
  RegistrationStatus,
  SessionClass,
} from "../src/client/session-classification"
import { connectionNotice, shellNotice, shellView } from "../src/client/shell/shell-view"
import { bot } from "./support/client"

describe("shellView", () => {
  const target = bot("x", "m1")

  it("is neutral while a main view without a session is unknown, and DSH's once it is stock", () => {
    expect(shellView(undefined, { kind: "unknown" }, null)).toEqual({ kind: "classifying" })
    expect(shellView(undefined, { kind: "stock" }, null)).toEqual({ kind: "stock" })
  })

  it("follows the session's class", () => {
    const cases: [SessionClass, ReturnType<typeof shellView>][] = [
      [{ kind: "unknown" }, { kind: "classifying" }],
      [{ kind: "stock" }, { kind: "stock" }],
      [
        { kind: "bot", botId: "x", bot: target, source: "bots" },
        { kind: "bot", sessionId: "m1", bot: { kind: "known", bot: target } },
      ],
      [
        { kind: "bot", botId: "x", bot: undefined, source: "preset" },
        { kind: "bot", sessionId: "m1", bot: { kind: "pending" } },
      ],
      [
        { kind: "bot", botId: undefined, bot: undefined, source: "bots" },
        { kind: "bot", sessionId: "m1", bot: { kind: "pending" } },
      ],
    ]
    for (const [session, view] of cases) expect(shellView("m1", session, null)).toEqual(view)
  })
})

describe("shellView with a creation's progress", () => {
  it("shows the progress over any session or class", () => {
    expect(shellView("m1", { kind: "stock" }, "b")).toEqual({ kind: "progress", botId: "b" })
    expect(shellView(undefined, { kind: "unknown" }, "b")).toEqual({ kind: "progress", botId: "b" })
  })
})

describe("connectionNotice", () => {
  const snapshot = { bots: [], pending: [], preparingSessionIds: [] }

  it("speaks only while reconnecting or without bots", () => {
    const cases: [BotsState, ReturnType<typeof connectionNotice>][] = [
      [{ status: "loading" }, undefined],
      [{ status: "ready", snapshot }, undefined],
      [{ status: "reconnecting", snapshot }, "reconnecting"],
      [{ status: "unavailable" }, "unavailable"],
      [{ status: "unavailable", error: "watch" }, "unavailable"],
      [{ status: "failed", error: "mount" }, "unavailable"],
    ]
    for (const [state, notice] of cases) expect(connectionNotice(state)).toBe(notice)
  })
})
describe("shellNotice", () => {
  const notice = { key: "notice.refused", serial: 1 }

  it("puts a refused lockdown first until dismissed, then the viewer's notice", () => {
    const refused: RegistrationStatus = { state: "refused", error: "taken" }
    expect(shellNotice(refused, false, notice)).toEqual({ kind: "lockdown" })
    expect(shellNotice(refused, true, notice)).toEqual({ kind: "viewer", notice })
    expect(shellNotice(refused, true, undefined)).toBeUndefined()
    expect(shellNotice({ state: "active" }, false, notice)).toEqual({ kind: "viewer", notice })
  })
})
