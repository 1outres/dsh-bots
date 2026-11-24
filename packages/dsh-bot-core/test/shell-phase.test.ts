import { describe, expect, it } from "vitest"
import { botShellView, shellPhase } from "../src/client/shell-phase"

describe("shellPhase (copied from DSH's ConversationMainPanel)", () => {
  const conversation = { activeTargets: new Set<string>() }
  const session = (extra: Record<string, unknown>) => ({ blank: true, running: false, ...extra })

  it("is the hero without a session or for an open blank session", () => {
    expect(
      shellPhase({
        sessionId: undefined,
        session: undefined,
        conversation: undefined,
        summaryBlank: undefined,
      }),
    ).toEqual({ phase: "hero", hero: true })
    expect(
      shellPhase({
        sessionId: "s",
        session: session({ openState: "open" }),
        conversation,
        summaryBlank: undefined,
      }),
    ).toEqual({ phase: "hero", hero: true })
  })

  it("settles while a session not proven blank replays", () => {
    expect(
      shellPhase({
        sessionId: "s",
        session: session({ openState: "loading" }),
        conversation,
        summaryBlank: false,
      }),
    ).toEqual({ phase: "settling", hero: false })
    expect(
      shellPhase({
        sessionId: "s",
        session: session({ openState: "loading" }),
        conversation,
        summaryBlank: true,
      }),
    ).toEqual({ phase: "hero", hero: true })
  })

  it("is active once the session has a turn, runs, or a target is active", () => {
    const active = { phase: "active", hero: false }
    const input = (s: Record<string, unknown>, targets: string[] = []) => ({
      sessionId: "s",
      session: session({ openState: "open", ...s }),
      conversation: { activeTargets: new Set(targets) },
      summaryBlank: undefined,
    })
    expect(shellPhase(input({ blank: false }))).toEqual(active)
    expect(shellPhase(input({ running: true }))).toEqual(active)
    expect(shellPhase(input({}, ["chat"]))).toEqual(active)
    // A prompt attempted on a blank session leaves the hero (engaging).
    expect(shellPhase(input({ promptAttempted: true }))).toEqual(active)
  })
})

describe("botShellView", () => {
  it("draws a blank session as active unless its opening message is awaited", () => {
    const hero = { phase: "hero", hero: true } as const
    expect(botShellView(hero, false)).toEqual({
      kind: "conversation",
      phase: "active",
      hero: false,
    })
    expect(botShellView(hero, true)).toEqual({ kind: "preparing" })
  })

  it("keeps every other phase, never as the hero", () => {
    for (const phase of ["settling", "active"] as const) {
      for (const awaiting of [false, true]) {
        expect(botShellView({ phase, hero: false }, awaiting)).toEqual({
          kind: "conversation",
          phase,
          hero: false,
        })
      }
    }
  })
})
