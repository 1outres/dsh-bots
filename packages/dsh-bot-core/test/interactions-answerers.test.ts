import { describe, expect, it } from "vitest"
import type { BotChannelOutput } from "../src/contract"
import {
  createApprovalAnswerer,
  createQuestionAnswerer,
  type WaitClaim,
} from "../src/host/interactions/answerers"
import { createInteractionBoard, type InteractionPlace } from "../src/host/interactions/board"
import { createContinuedQuestions } from "../src/host/interactions/continued"
import {
  type DshPendingQuestion,
  type DshQuestionAnswer,
  type DshQuestionItem,
  questionErrorCode,
  questionRejection,
} from "../src/host/interactions/dsh"
import { presentQuestions } from "../src/host/interactions/presentation"
import { settle } from "./channels-support"

interface Agent {
  readonly id: string
  readonly bot?: string
  readonly parent?: string
}

const PLACE: InteractionPlace = { botId: "a", sessionId: "main-a", main: true }

function setup() {
  let ids = 0
  let now = 1000
  const timers: { at: number; work: () => void; live: boolean }[] = []
  const published: BotChannelOutput[] = []
  const board = createInteractionBoard({
    opened: () => {},
    newId: () => `i${++ids}`,
    publish: (_botId, output) => published.push(output),
  })
  const rows = new Map<string, DshPendingQuestion[]>()
  const replies: { callId: string; answer: DshQuestionAnswer }[] = []
  let replyOutcome: () => boolean = () => true
  const continued = createContinuedQuestions({
    board,
    placeOf: (sessionId) => (sessionId === "main-a" ? PLACE : undefined),
    rows: (sessionId) => rows.get(sessionId),
    async reply(_sessionId, callId, answer) {
      replies.push({ callId, answer })
      return replyOutcome()
    },
  })
  const claims: string[] = []
  const released: string[] = []
  let claimFrame: number | undefined = 60_000
  const approvals = createApprovalAnswerer<Agent>({
    board,
    place: (agent) =>
      agent.bot === "a" ? { place: PLACE, delegated: agent.parent !== undefined } : undefined,
  })
  const questions = createQuestionAnswerer<Agent>({
    board,
    continued,
    place: (agent) => (agent.bot === "a" && agent.parent === undefined ? PLACE : undefined),
    async claim(_agent, callId): Promise<WaitClaim | undefined> {
      claims.push(callId)
      return claimFrame === undefined
        ? undefined
        : { remainingMs: claimFrame, release: () => released.push(callId) }
    },
    now: () => now,
    later(ms, work) {
      const timer = { at: now + ms, work, live: true }
      timers.push(timer)
      return () => {
        timer.live = false
      }
    },
  })
  const answerers = {
    question: questions.answer,
    approval: approvals.answer,
    delegateAll() {
      questions.delegateAll()
      approvals.delegateAll()
    },
  }
  const advance = (ms: number) => {
    now += ms
    for (const timer of timers) {
      if (timer.live && timer.at <= now) {
        timer.live = false
        timer.work()
      }
    }
  }
  const scope = { kind: "session", sessionId: "main-a" } as const
  const web = { via: "web" } as const
  return {
    board,
    published,
    rows,
    replies,
    continued,
    answerers,
    claims,
    released,
    advance,
    scope,
    web,
    setClaim: (value: number | undefined) => {
      claimFrame = value
    },
    setReply: (outcome: () => boolean) => {
      replyOutcome = outcome
    },
  }
}

const BOT: Agent = { id: "main-a", bot: "a" }
const PICK: DshQuestionItem = {
  id: "q",
  question: "Which?",
  options: [{ label: "A" }, { label: "B", description: "the other" }],
}
const nextAnswer = async (): Promise<DshQuestionAnswer> => ({
  answers: [{ id: "next", selected: [] }],
})

describe("bot-core in DSH's waterfalls", () => {
  it("passes every Agent that is not a bot's root session on to next(), untouched", async () => {
    const { answerers, board } = setup()
    expect(await answerers.question({ questions: [PICK], agent: { id: "w" } }, nextAnswer)).toEqual(
      {
        answers: [{ id: "next", selected: [] }],
      },
    )
    expect(await answerers.question({ questions: [PICK] }, nextAnswer)).toMatchObject({
      answers: [{ id: "next" }],
    })
    expect(
      await answerers.approval({ agent: { id: "w" }, toolName: "bash" }, async () => "unavailable"),
    ).toBe("unavailable")
    expect(board.openIn("main-a")).toEqual([])
  })

  it("claims a bot's question without next() and resolves the waterfall with the board's answer", async () => {
    const { answerers, board, scope, web } = setup()
    let delegated = false
    const pending = answerers.question({ questions: [PICK], agent: BOT }, async () => {
      delegated = true
      return { answers: [] }
    })
    await settle()
    const [interaction] = board.openIn("main-a")
    expect(interaction).toMatchObject({
      kind: "question",
      questions: [{ id: "q", multiSelect: false }],
    })
    expect(
      await board.answer(
        scope,
        interaction?.id ?? "",
        { kind: "question", answers: [{ id: "q", selected: ["B"] }] },
        web,
      ),
    ).toEqual({ accepted: true })
    expect(await pending).toEqual({ answers: [{ id: "q", selected: ["B"] }] })
    expect(delegated).toBe(false)
  })

  it("withdraws a question when its request is aborted (a stopped turn), rejecting with the abort", async () => {
    const { answerers, board, published } = setup()
    const controller = new AbortController()
    const pending = answerers.question(
      { questions: [PICK], agent: BOT, signal: controller.signal },
      nextAnswer,
    )
    await settle()
    controller.abort(questionRejection("ASK_ABORTED"))
    await expect(pending).rejects.toMatchObject({ code: "ASK_ABORTED" })
    expect(board.openIn("main-a")).toEqual([])
    expect(published.at(-1)).toMatchObject({ closure: { resolution: { kind: "withdrawn" } } })
  })

  it("answers tool approvals once or rejects them, and cancels a withdrawn one", async () => {
    const { answerers, board, scope, web } = setup()
    const pending = answerers.approval(
      { agent: { id: "sub", bot: "a", parent: "main-a" }, toolName: "bash", reason: "escalate" },
      async () => "unavailable",
    )
    await settle()
    const [interaction] = board.openIn("main-a")
    expect(interaction).toEqual({
      id: "i1",
      kind: "approval",
      subject: "bash",
      question: { en: "escalate" },
      actions: ["allow-once", "reject"],
      delegated: true,
    })
    expect(
      await board.answer(scope, "i1", { kind: "approval", action: "always" }, web),
    ).toMatchObject({ reason: "invalid" })
    await board.answer(scope, "i1", { kind: "approval", action: "allow-once" }, web)
    expect(await pending).toBe("allowed-once")

    const controller = new AbortController()
    const withdrawn = answerers.approval(
      { agent: BOT, toolName: "bash", signal: controller.signal },
      async () => "unavailable",
    )
    await settle()
    expect(board.openIn("main-a")[0]).toMatchObject({
      question: { en: "Tool bash requests privileged execution", ja: expect.any(String) },
    })
    controller.abort()
    expect(await withdrawn).toBe("cancelled")
    expect(board.openIn("main-a")).toEqual([])
  })

  it("presents an approval intent with its labels and offers always only when the asker does", async () => {
    const { answerers, board, scope, web } = setup()
    const item: DshQuestionItem = {
      id: "cua",
      question: "Allow control of Notes?",
      detail: "It can read the screen.",
      options: [{ label: "Allow for this session" }, { label: "Deny" }, { label: "Always allow" }],
      intent: {
        kind: "approval",
        approve: "Allow for this session",
        reject: "Deny",
        always: "Always allow",
        subject: { name: "Notes" },
        display: { question: { en: "Allow Notes?", ja: "メモを許可しますか？" } },
      },
    }
    const pending = answerers.question({ questions: [item], agent: BOT }, nextAnswer)
    await settle()
    expect(board.openIn("main-a")[0]).toEqual({
      id: "i1",
      kind: "approval",
      subject: "Notes",
      question: { en: "Allow Notes?", ja: "メモを許可しますか？" },
      detail: { en: "It can read the screen." },
      actions: ["allow-once", "reject", "always"],
      allowLabel: { en: "Allow for this session" },
      delegated: false,
    })
    await board.answer(scope, "i1", { kind: "approval", action: "always" }, web)
    expect(await pending).toEqual({ answers: [{ id: "cua", selected: ["Always allow"] }] })
    const withoutAlways = presentQuestions(
      [
        {
          ...item,
          options: item.options?.slice(0, 2),
          intent: { kind: "approval", approve: "Allow for this session", reject: "Deny" },
        },
      ],
      false,
    )
    expect(withoutAlways.kind === "approval" ? withoutAlways.labels : undefined).toEqual({
      "allow-once": "Allow for this session",
      reject: "Deny",
    })
  })

  it("reviews a plan: approve, send back with feedback, or without it as DSH's card cancels", async () => {
    const plan = (options: { label: string }[]): DshQuestionItem => ({
      id: "review",
      question: "Approve this plan?",
      detail: "# Plan\n\n1. Do it",
      options,
      intent: { kind: "plan-review", approve: "Approve" },
    })
    const run = async (item: DshQuestionItem, answer: { approved: boolean; feedback?: string }) => {
      const { answerers, board, scope, web } = setup()
      const pending = answerers.question({ questions: [item], agent: BOT }, nextAnswer)
      await settle()
      expect(board.openIn("main-a")[0]).toEqual({
        id: "i1",
        kind: "plan-review",
        question: "Approve this plan?",
        plan: "# Plan\n\n1. Do it",
      })
      await board.answer(scope, "i1", { kind: "plan-review", ...answer }, web)
      return pending.then(
        (value) => value,
        (error: unknown) => questionErrorCode(error),
      )
    }
    const both = plan([{ label: "Approve" }, { label: "Keep planning" }])
    expect(await run(both, { approved: true })).toEqual({
      answers: [{ id: "review", selected: ["Approve"] }],
    })
    expect(await run(both, { approved: false, feedback: "Add tests" })).toEqual({
      answers: [{ id: "review", selected: [], custom: "Add tests" }],
    })
    expect(await run(both, { approved: false })).toBe("ASK_CANCELLED")
    expect(await run(plan([{ label: "Approve" }]), { approved: false })).toBe("ASK_CANCELLED")
  })

  it("hands every waiting request to the next answerer when bot-core unloads", async () => {
    const { answerers, board } = setup()
    const question = answerers.question({ questions: [PICK], agent: BOT }, nextAnswer)
    const approval = answerers.approval({ agent: BOT, toolName: "bash" }, async () => "rejected")
    await settle()
    answerers.delegateAll()
    expect(await question).toMatchObject({ answers: [{ id: "next" }] })
    expect(await approval).toBe("rejected")
    expect(board.openIn("main-a")).toEqual([])
  })
})

describe("timed questions", () => {
  const timed = (agent: Agent = BOT) => ({
    questions: [PICK],
    agent,
    wait: { callId: "call-1", timed: true },
  })

  it("claims DSH's foreground wait, counts down, and holds once a person starts answering", async () => {
    const { answerers, board, claims, released, advance, scope, web } = setup()
    const pending = answerers.question(timed(), nextAnswer)
    await settle()
    expect(claims).toEqual(["call-1"])
    expect(board.openIn("main-a")[0]).toMatchObject({
      wait: { state: "counting", deadline: 61_000 },
    })
    board.hold(scope, "i1")
    expect(board.openIn("main-a")[0]).toMatchObject({ wait: { state: "held" } })
    advance(120_000)
    expect(board.openIn("main-a")).toHaveLength(1)
    await board.answer(
      scope,
      "i1",
      { kind: "question", answers: [{ id: "q", selected: ["A"] }] },
      web,
    )
    expect(await pending).toEqual({ answers: [{ id: "q", selected: ["A"] }] })
    expect(released).toEqual(["call-1"])
  })

  it("times out as DSH's ASK_TIMED_OUT, stays answerable as continued, and answers then with a late reply", async () => {
    const { answerers, board, rows, continued, replies, advance, scope, web, published, setReply } =
      setup()
    const pending = answerers.question(timed(), nextAnswer)
    await settle()
    rows.set("main-a", [{ callId: "call-1", questions: [PICK], state: "open" }])
    continued.reconcile("main-a")
    advance(60_000)
    await expect(pending).rejects.toMatchObject({ code: "ASK_TIMED_OUT" })
    expect(board.openIn("main-a")).toEqual([
      expect.objectContaining({ id: "i1", wait: { state: "continued" } }),
    ])
    expect(published.map((output) => output.kind)).toEqual([
      "interaction-opened",
      "interaction-updated",
    ])
    rows.set("main-a", [{ callId: "call-1", questions: [PICK], state: "continued" }])
    continued.reconcile("main-a")
    expect(board.openIn("main-a")).toHaveLength(1)
    setReply(() => {
      throw Object.assign(new Error("a reply is already queued"), {
        name: "UserQuestionError",
        code: "REPLY_QUEUED",
      })
    })
    const answer = { kind: "question", answers: [{ id: "q", selected: ["B"] }] } as const
    expect(await board.answer(scope, "i1", answer, web)).toMatchObject({ reason: "not-open" })
    setReply(() => true)
    expect(await board.answer(scope, "i1", answer, web)).toEqual({ accepted: true })
    expect(replies.at(-1)).toEqual({
      callId: "call-1",
      answer: { answers: [{ id: "q", selected: ["B"] }] },
    })
    continued.reconcile("main-a")
    expect(board.openIn("main-a")).toEqual([])
  })

  it("keeps nothing for a timed call answered in time, and withdraws an adopted call answered elsewhere", async () => {
    const { answerers, board, rows, continued, scope, web, advance, published } = setup()
    rows.set("main-a", [{ callId: "call-1", questions: [PICK], state: "open" }])
    const inTime = answerers.question(timed(), nextAnswer)
    await settle()
    await board.answer(
      scope,
      "i1",
      { kind: "question", answers: [{ id: "q", selected: ["A"] }] },
      web,
    )
    await inTime
    rows.set("main-a", [])
    continued.reconcile("main-a")
    rows.set("main-a", [{ callId: "call-1", questions: [PICK], state: "continued" }])
    continued.reconcile("main-a")
    expect(board.openIn("main-a")).toEqual([
      expect.objectContaining({ id: "i2", wait: { state: "continued" } }),
    ])

    const late = answerers.question(
      { questions: [PICK], agent: BOT, wait: { callId: "call-2", timed: true } },
      nextAnswer,
    )
    await settle()
    rows.set("main-a", [
      { callId: "call-1", questions: [PICK], state: "continued" },
      { callId: "call-2", questions: [PICK], state: "open" },
    ])
    advance(60_000)
    await expect(late).rejects.toMatchObject({ code: "ASK_TIMED_OUT" })
    rows.set("main-a", [{ callId: "call-1", questions: [PICK], state: "continued" }])
    continued.reconcile("main-a")
    expect(board.openIn("main-a").map((interaction) => interaction.id)).toEqual(["i2"])
    expect(published.at(-1)).toMatchObject({
      kind: "interaction-closed",
      closure: { id: "i3", resolution: { kind: "withdrawn" } },
    })
  })

  it("rejects with the abort when DSH's wait already ended before bot-core could claim it", async () => {
    const { answerers, board, setClaim } = setup()
    setClaim(undefined)
    await expect(answerers.question(timed(), nextAnswer)).rejects.toMatchObject({
      code: "ASK_ABORTED",
    })
    expect(board.openIn("main-a")).toEqual([])
  })
})

describe("continued questions", () => {
  it("opens the projection's continued calls, withdraws vanished ones, and reopens a discarded reply", async () => {
    const { board, rows, continued, scope, web, setReply } = setup()
    rows.set("main-a", [{ callId: "old", questions: [PICK], state: "continued" }])
    continued.reconcile("main-a")
    continued.reconcile("main-a")
    expect(board.openIn("main-a")).toEqual([
      {
        id: "i1",
        kind: "question",
        questions: [expect.objectContaining({ id: "q" })],
        wait: { state: "continued" },
      },
    ])
    await board.answer(scope, "i1", { kind: "question", answers: [{ id: "q", selected: [] }] }, web)
    continued.reconcile("main-a")
    expect(board.openIn("main-a")).toEqual([])
    continued.released("main-a", "old")
    expect(board.openIn("main-a")).toHaveLength(1)
    setReply(() => false)
    expect(
      await board.answer(
        scope,
        "i2",
        { kind: "question", answers: [{ id: "q", selected: [] }] },
        web,
      ),
    ).toMatchObject({ reason: "not-open" })
    rows.set("main-a", [])
    continued.reconcile("main-a")
    expect(board.openIn("main-a")).toEqual([])
    expect(board.closedIn("main-a").at(-1)?.resolution).toEqual({ kind: "withdrawn" })
  })

  it("follows bot sessions only", () => {
    const { board, rows, continued } = setup()
    rows.set("w1", [{ callId: "x", questions: [PICK], state: "continued" }])
    continued.reconcile("w1")
    expect(board.openIn("w1")).toEqual([])
  })
})
