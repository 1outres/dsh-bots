import { describe, expect, it } from "vitest"
import type { BotChannelOutput } from "../src/contract"
import {
  createInteractionBoard,
  KEPT_CLOSURE_SESSIONS,
  KEPT_CLOSURES,
} from "../src/host/interactions/board"
import { createInteractionPanel } from "../src/host/interactions/panel"
import { interactionAnswerProblem } from "../src/shared/interactions"

const MAIN = { botId: "a", sessionId: "main-a", main: true }
const OTHER = { botId: "a", sessionId: "side-a", main: false }

function setup() {
  const published: [string, BotChannelOutput][] = []
  let ids = 0
  const board = createInteractionBoard({
    opened: () => {},
    newId: () => `i${++ids}`,
    publish: (botId, output) => published.push([botId, output]),
  })
  const approval = (place = MAIN) => {
    const taken: unknown[] = []
    const entry = board.open(
      place,
      (id) => ({
        id,
        kind: "approval",
        subject: "bash",
        question: { en: "Run it?" },
        actions: ["allow-once", "reject"],
        delegated: false,
      }),
      {
        async answer(answer) {
          taken.push(answer)
          return { accepted: true }
        },
      },
    )
    return { entry, taken }
  }
  return { board, published, approval }
}

describe("interaction board", () => {
  it("takes the first answer from anywhere and tells the Main session's channels who answered and what", async () => {
    const { board, published, approval } = setup()
    const { entry, taken } = approval()
    const answer = { kind: "approval", action: "reject" } as const
    const [web, channel] = await Promise.all([
      board.answer({ kind: "session", sessionId: "main-a" }, entry.id, answer, { via: "web" }),
      board.answer({ kind: "main", botId: "a" }, entry.id, answer, {
        via: "channel",
        channelId: "discord",
      }),
    ])
    expect(web).toEqual({ accepted: true })
    expect(channel).toMatchObject({ accepted: false, reason: "not-open" })
    expect(taken).toEqual([answer])
    expect(entry.isOpen()).toBe(false)
    expect(published.map(([, output]) => output.kind)).toEqual([
      "interaction-opened",
      "interaction-closed",
    ])
    expect(published[1]?.[1]).toEqual({
      kind: "interaction-closed",
      closure: {
        id: "i1",
        kind: "approval",
        resolution: { kind: "answered", by: { via: "web" }, answer },
      },
    })
    expect(board.closedIn("main-a")).toHaveLength(1)
  })

  it("keeps other sessions' interactions off the channels and out of reach of a channel", async () => {
    const { board, published, approval } = setup()
    const { entry } = approval(OTHER)
    expect(published).toEqual([])
    expect(board.mainOf("a")).toEqual([])
    expect(board.openIn("side-a")).toHaveLength(1)
    const answer = { kind: "approval", action: "allow-once" } as const
    expect(
      await board.answer({ kind: "main", botId: "a" }, entry.id, answer, {
        via: "channel",
        channelId: "discord",
      }),
    ).toMatchObject({ reason: "not-open" })
    expect(
      await board.answer({ kind: "session", sessionId: "main-a" }, entry.id, answer, {
        via: "web",
      }),
    ).toMatchObject({ reason: "not-open" })
    expect(
      await board.answer({ kind: "session", sessionId: "side-a" }, entry.id, answer, {
        via: "web",
      }),
    ).toEqual({ accepted: true })
  })

  it("refuses an answer that does not fit, and keeps it open when the asker refuses one", async () => {
    const { board } = setup()
    const entry = board.open(
      MAIN,
      (id) => ({
        id,
        kind: "question",
        questions: [{ id: "q", question: "Pick", options: [{ label: "A" }], multiSelect: false }],
      }),
      { answer: async () => ({ accepted: false, reason: "failed", message: "busy" }) },
    )
    const scope = { kind: "main", botId: "a" } as const
    const origin = { via: "channel", channelId: "discord" } as const
    expect(
      await board.answer(
        scope,
        entry.id,
        { kind: "question", answers: [{ id: "q", selected: ["B"] }] },
        origin,
      ),
    ).toMatchObject({ reason: "invalid" })
    expect(
      await board.answer(scope, entry.id, { kind: "approval", action: "reject" }, origin),
    ).toMatchObject({ reason: "invalid" })
    expect(
      await board.answer(
        scope,
        entry.id,
        { kind: "question", answers: [{ id: "q", selected: ["A"] }] },
        origin,
      ),
    ).toMatchObject({ reason: "failed", message: "busy" })
    expect(entry.isOpen()).toBe(true)
  })

  it("publishes updates, withdraws, and keeps only the latest closures", () => {
    const { board, published, approval } = setup()
    const { entry } = approval()
    entry.update({
      id: entry.id,
      kind: "approval",
      subject: "bash",
      question: { en: "Run it now?" },
      actions: ["allow-once", "reject"],
      delegated: false,
    })
    expect(published.at(-1)?.[1].kind).toBe("interaction-updated")
    expect(() =>
      entry.update({ id: entry.id, kind: "plan-review", question: "x", plan: "y" }),
    ).toThrow("cannot change")
    entry.withdraw()
    expect(published.at(-1)?.[1]).toMatchObject({
      kind: "interaction-closed",
      closure: { resolution: { kind: "withdrawn" } },
    })
    for (let index = 0; index < KEPT_CLOSURES + 2; index += 1) approval().entry.withdraw()
    expect(board.closedIn("main-a")).toHaveLength(KEPT_CLOSURES)
    approval()
    board.withdrawAll()
    expect(board.openIn("main-a")).toEqual([])
  })

  it("serves the browser a bot session's open interactions with their remaining time, and closures with channel names", async () => {
    const { board } = setup()
    const entry = board.open(
      MAIN,
      (id) => ({
        id,
        kind: "question",
        questions: [{ id: "q", question: "Pick", options: [], multiSelect: false }],
        wait: { state: "counting", deadline: 5000 },
      }),
      { answer: async () => ({ accepted: true }) },
    )
    const panel = createInteractionPanel({
      board,
      isBotSession: (sessionId) => sessionId === "main-a",
      channelName: (id) => (id === "discord" ? "Discord" : undefined),
      now: () => 2000,
    })
    expect(() => panel.snapshot("w1")).toThrow("not a bot session")
    expect(panel.snapshot("main-a").open).toEqual([
      { interaction: expect.objectContaining({ id: entry.id }), remainingMs: 3000 },
    ])
    await board.answer(
      { kind: "main", botId: "a" },
      entry.id,
      { kind: "question", answers: [{ id: "q", selected: [], custom: "hi" }] },
      { via: "channel", channelId: "discord" },
    )
    expect(panel.snapshot("main-a")).toMatchObject({
      open: [],
      channelNames: { discord: "Discord" },
    })
  })
})

describe("interaction history", () => {
  it("keeps the closures of the sessions closed in most recently only", () => {
    const { board, approval } = setup()
    const place = (at: number) => ({ botId: "a", sessionId: `s${at}`, main: false })
    for (let at = 0; at <= KEPT_CLOSURE_SESSIONS; at += 1) approval(place(at)).entry.withdraw()
    approval(place(1)).entry.withdraw()
    approval(place(KEPT_CLOSURE_SESSIONS + 1)).entry.withdraw()
    expect(board.closedIn("s0")).toEqual([])
    expect(board.closedIn("s1")).toHaveLength(2)
    expect(board.closedIn("s2")).toEqual([])
    expect(board.closedIn("s3")).toHaveLength(1)
  })
})

describe("interaction answers", () => {
  const question = {
    id: "i",
    kind: "question",
    questions: [
      { id: "one", question: "One", options: [{ label: "A" }, { label: "B" }], multiSelect: false },
      {
        id: "many",
        question: "Many",
        options: [{ label: "A" }, { label: "B" }],
        multiSelect: true,
      },
    ],
  } as const
  const answers = (...items: { id: string; selected: string[]; custom?: string }[]) =>
    ({ kind: "question", answers: items }) as const

  it("follows DSH's answer shape: one item per question, a single-select choice or text, skips", () => {
    expect(
      interactionAnswerProblem(
        question,
        answers(
          { id: "one", selected: ["A"] },
          { id: "many", selected: ["A", "B"], custom: "and C" },
        ),
      ),
    ).toBeUndefined()
    expect(
      interactionAnswerProblem(
        question,
        answers({ id: "one", selected: [] }, { id: "many", selected: [] }),
      ),
    ).toBeUndefined()
    expect(
      interactionAnswerProblem(
        question,
        answers({ id: "one", selected: ["A", "B"] }, { id: "many", selected: [] }),
      ),
    ).toContain("one choice")
    expect(
      interactionAnswerProblem(
        question,
        answers({ id: "one", selected: ["A"], custom: "x" }, { id: "many", selected: [] }),
      ),
    ).toContain("not both")
    expect(
      interactionAnswerProblem(
        question,
        answers({ id: "one", selected: [], custom: " " }, { id: "many", selected: [] }),
      ),
    ).toContain("empty")
    expect(interactionAnswerProblem(question, answers({ id: "one", selected: [] }))).toContain(
      "every question",
    )
  })

  it("takes only offered approval actions and plan decisions without feedback on approval", () => {
    const approval = {
      id: "a",
      kind: "approval",
      question: { en: "?" },
      actions: ["allow-once", "reject"],
      delegated: false,
    } as const
    expect(interactionAnswerProblem(approval, { kind: "approval", action: "always" })).toContain(
      "always",
    )
    const plan = { id: "p", kind: "plan-review", question: "?", plan: "# P" } as const
    expect(
      interactionAnswerProblem(plan, { kind: "plan-review", approved: true, feedback: "x" }),
    ).toBeDefined()
    expect(
      interactionAnswerProblem(plan, { kind: "plan-review", approved: false, feedback: "x" }),
    ).toBeUndefined()
  })
})
