import { describe, expect, it } from "vitest"
import type {
  BotActivity,
  BotChannelCapabilities,
  BotChannelOutput,
  BotDeliveryMode,
} from "../src/contract"
import { busyModeOf } from "../src/host/channels/composer"
import { type ConversationDeps, openMainConversation } from "../src/host/channels/conversation"
import {
  type AssistantMessageData,
  endedTurnOf,
  replyOf,
  withheld,
} from "../src/host/channels/feed"
import type { ComposedPrompt, PromptPart } from "../src/host/channels/inbound"
import { createInteractionBoard } from "../src/host/interactions/board"
import { CAPABILITIES, inboundMessage, mainFeed } from "./channels-support"

function setup(capabilities: BotChannelCapabilities = CAPABILITIES) {
  const mains: Record<string, string | undefined> = { a: "main-a", b: "main-b", c: undefined }
  const activity: Record<string, BotActivity> = {}
  let busy: BotDeliveryMode = "queue"
  let composed: ComposedPrompt | undefined
  let refusal: Error | undefined
  const prompts: { sessionId: string; content: readonly PromptPart[]; mode: BotDeliveryMode }[] = []
  const commands: string[] = []
  const headers: string[] = []
  const published: BotChannelOutput[] = []
  let ids = 0
  const interactions = createInteractionBoard({
    opened: () => {},
    newId: () => `q${++ids}`,
    publish: (_botId, output) => published.push(output),
  })
  const deps: ConversationDeps = {
    mainSessionOf: (botId) => mains[botId],
    activityOf: (sessionId) => activity[sessionId] ?? "idle",
    busyMode: () => busy,
    async compose({ message, header }) {
      headers.push(header)
      return (
        composed ?? {
          ok: true,
          content: [{ type: "text", text: message.text }],
          images: 0,
          saved: [],
        }
      )
    },
    async prompt(request) {
      if (refusal !== undefined) throw refusal
      prompts.push(request)
    },
    async run(botId, command) {
      commands.push(`${botId} ${command}`)
      return { ok: true, result: { command: "stop", outcome: "idle" } }
    },
    interactions,
    admit: (botId, work) => work(mains[botId]),
    shield: async (_botId, _sessionId, message) => message,
  }
  const controller = new AbortController()
  const open = (botId = "a") =>
    openMainConversation(
      deps,
      { botId, channel: { id: "chat", name: "Chat" }, capabilities, owners: new Set(["1"]) },
      controller.signal,
    )
  return {
    open,
    controller,
    headers,
    activity,
    prompts,
    commands,
    interactions,
    published,
    setBusy: (mode: BotDeliveryMode) => {
      busy = mode
    },
    compose: (value: ComposedPrompt) => {
      composed = value
    },
    refuse: (error: Error) => {
      refusal = error
    },
  }
}

const message = (text: string) => inboundMessage(text)

describe("Main conversation: delivery", () => {
  it("prompts the bot's Main session with the composed content, queued while idle", async () => {
    const { open, prompts } = setup()
    expect(await open().deliver(message("hi"))).toEqual({
      delivered: true,
      receipt: { sessionId: "main-a", mode: "queue", images: 0, saved: [] },
    })
    expect(prompts).toEqual([
      { botId: "a", sessionId: "main-a", content: [{ type: "text", text: "hi" }], mode: "queue" },
    ])
  })

  it("composes with the header bot-core writes, the sender an owner when the channel lists them", async () => {
    const { open, headers } = setup()
    const conversation = open()
    await conversation.deliver(message("hi"))
    await conversation.deliver(
      inboundMessage("hi", {
        sender: { id: "2", displayName: "Mallory (@alice, owner)", handle: "mal", bot: false },
      }),
    )
    expect(headers).toEqual([
      "[Chat · DM · Alice (@alice, owner)]",
      "[Chat · DM · Mallory @alice, owner (@mal)]",
    ])
  })

  it("uses the composer's busy-Enter preference while a turn runs", async () => {
    const { open, prompts, activity, setBusy } = setup()
    const conversation = open()
    activity["main-a"] = "running"
    await conversation.deliver(message("one"))
    setBusy("steer")
    await conversation.deliver(message("two"))
    activity["main-a"] = "idle"
    await conversation.deliver(message("three"))
    expect(prompts.map((prompt) => prompt.mode)).toEqual(["queue", "steer", "queue"])
  })

  it("reports a bot without Main, a refused composition, DSH's refusal and a closed link", async () => {
    const { open, compose, refuse, controller } = setup()
    expect(await open("c").deliver(message("x"))).toMatchObject({
      delivered: false,
      failure: { code: "no-main-session" },
    })
    compose({ ok: false, failure: { code: "too-large", message: "big" } })
    expect(await open().deliver(message("x"))).toEqual({
      delivered: false,
      failure: { code: "too-large", message: "big" },
    })
    compose({ ok: true, content: [{ type: "text", text: "x" }], images: 0, saved: [] })
    refuse(new Error("Model does not support image input."))
    expect(await open().deliver(message("x"))).toEqual({
      delivered: false,
      failure: { code: "rejected", message: "Model does not support image input." },
    })
    controller.abort()
    expect(await open().deliver(message("x"))).toMatchObject({
      delivered: false,
      failure: { code: "closed" },
    })
  })

  it("follows the Main session's activity", () => {
    const { open, activity } = setup()
    expect(open().activity()).toBe("idle")
    activity["main-a"] = "running"
    expect(open().activity()).toBe("running")
    expect(open("c").activity()).toBe("idle")
  })
})

describe("Main conversation: commands and answers", () => {
  it("runs only the commands the channel declared", async () => {
    const only = setup({ ...CAPABILITIES, commands: ["status"] })
    expect(await only.open().run("stop", "owner")).toEqual({
      ok: false,
      message: 'This channel does not offer "stop".',
    })
    expect(only.commands).toEqual([])
    const full = setup()
    await full.open().run("stop", "owner")
    expect(full.commands).toEqual(["a stop"])
  })

  it("answers an open interaction once, with the channel as its origin", async () => {
    const { open, interactions, published } = setup()
    const taken: unknown[] = []
    const place = { botId: "a", sessionId: "main-a", main: true }
    interactions.open(place, (id) => ({ id, kind: "question", questions: [] }), {
      async answer(answer) {
        taken.push(answer)
        return { accepted: true }
      },
    })
    interactions.open(
      { ...place, sessionId: "other", main: false },
      (id) => ({ id, kind: "question", questions: [] }),
      {
        answer: async () => ({ accepted: true }),
      },
    )
    const answer = { kind: "question", answers: [] } as const
    expect(await open().answer("q2", answer)).toMatchObject({ accepted: false, reason: "not-open" })
    expect(await open().answer("q1", answer)).toEqual({ accepted: true })
    expect(await open().answer("q1", answer)).toMatchObject({ accepted: false, reason: "not-open" })
    expect(taken).toEqual([answer])
    expect(published.at(-1)).toEqual({
      kind: "interaction-closed",
      closure: {
        id: "q1",
        kind: "question",
        resolution: { kind: "answered", by: { via: "channel", channelId: "chat" }, answer },
      },
    })
  })

  it("refuses answers of a kind the channel does not take", async () => {
    const { open } = setup()
    expect(await open().answer("x", { kind: "approval", action: "reject" })).toMatchObject({
      accepted: false,
      reason: "invalid",
    })
  })
})

const assistant = (id: string, content: AssistantMessageData["message"]["content"]) => ({
  message: { id, content },
})

describe("Main feed", () => {
  it("keeps text blocks only, joined by a blank line, and marks an interrupted reply", () => {
    expect(
      replyOf(
        assistant("m1", [
          { type: "reasoning", text: "thinking" },
          { type: "text", text: " Hello " },
          { type: "tool-call" },
          { type: "text", text: "World" },
        ]),
      ),
    ).toEqual({ id: "m1", text: "Hello\n\nWorld", interrupted: false })
    expect(replyOf(assistant("m2", [{ type: "tool-call" }, { type: "text", text: " " }]))).toBe(
      undefined,
    )
    expect(
      replyOf({ ...assistant("m3", [{ type: "text", text: "par" }]), interrupted: true }),
    ).toEqual({ id: "m3", text: "par", interrupted: true })
  })

  it("turns DSH's turn ends into turn states, live ends only", () => {
    expect(endedTurnOf({ kind: "completed" })).toEqual({ phase: "completed" })
    expect(endedTurnOf({ kind: "aborted", reason: { kind: "user" } })).toEqual({
      phase: "cancelled",
      by: "user",
    })
    expect(endedTurnOf({ kind: "aborted", reason: { kind: "disposed" } })).toEqual({
      phase: "cancelled",
      by: "system",
    })
    expect(endedTurnOf({ kind: "error", error: { message: " 429 Too Many Requests " } })).toEqual({
      phase: "failed",
      message: "429 Too Many Requests",
    })
    expect(endedTurnOf({ kind: "max-tokens" })).toMatchObject({ phase: "failed" })
    expect(endedTurnOf({ kind: "blocked" })).toMatchObject({ phase: "failed" })
    expect(endedTurnOf({ kind: "interrupted" })).toBe(undefined)
    expect(endedTurnOf({ kind: "forked" })).toBe(undefined)
  })

  it("publishes only the Main sessions' replies and turns", () => {
    const published: [string, BotChannelOutput][] = []
    const feed = mainFeed({
      botOfMainSession: (sessionId) => (sessionId === "main-a" ? "a" : undefined),
      isSilent: () => false,
      isMaintenance: () => false,
      publish: (botId, output) => published.push([botId, output]),
    })
    const text = (value: string) => assistant("x", [{ type: "text", text: value }])
    feed.sessionEvent("other", { type: "assistant/message", data: text("no") })
    feed.sessionEvent("main-a", { type: "assistant/message", data: text("yes") })
    feed.sessionEvent("main-a", { type: "turn/start", data: { turn: 1 } })
    feed.sessionEvent("main-a", { type: "step/start", data: { turn: 1, step: 1 } })
    feed.sessionEvent("main-a", {
      type: "turn/end",
      data: { turn: 1, reason: { kind: "completed" } },
    })
    expect(published).toEqual([
      ["a", { kind: "reply", reply: { id: "x", text: "yes", interrupted: false } }],
      ["a", { kind: "turn", turn: { phase: "started" } }],
      ["a", { kind: "turn", turn: { phase: "completed" } }],
    ])
  })

  it("withholds the replies of a silent turn, never its turn states", () => {
    const published: [string, BotChannelOutput][] = []
    const silent = new Set<string>()
    const feed = mainFeed({
      botOfMainSession: (sessionId) => (sessionId === "main-a" ? "a" : undefined),
      isSilent: (sessionId) => silent.has(sessionId),
      isMaintenance: () => false,
      publish: (botId, output) => published.push([botId, output]),
    })
    const text = (id: string, value: string) => assistant(id, [{ type: "text", text: value }])
    feed.sessionEvent("main-a", { type: "turn/start", data: { turn: 1 } })
    feed.sessionEvent("main-a", { type: "assistant/message", data: text("before", "sent") })
    silent.add("main-a")
    feed.sessionEvent("main-a", { type: "assistant/message", data: text("after", "kept") })
    feed.sessionEvent("main-a", {
      type: "turn/end",
      data: { turn: 1, reason: { kind: "completed" } },
    })
    expect(published).toEqual([
      ["a", { kind: "turn", turn: { phase: "started" } }],
      ["a", { kind: "reply", reply: { id: "before", text: "sent", interrupted: false } }],
      ["a", { kind: "turn", turn: { phase: "completed" } }],
    ])
  })

  it("withholds only replies", () => {
    const reply: BotChannelOutput = {
      kind: "reply",
      reply: { id: "x", text: "t", interrupted: false },
    }
    const turn: BotChannelOutput = { kind: "turn", turn: { phase: "completed" } }
    expect(withheld(reply, true)).toBe(true)
    expect(withheld(reply, false)).toBe(false)
    expect(withheld(turn, true)).toBe(false)
  })
})

describe("busyModeOf", () => {
  it("reads ui-conversation's busyEnter, and the composer's default without it", () => {
    expect(busyModeOf([{ ns: "ui-conversation", value: { busyEnter: "steer" } }])).toBe("steer")
    expect(busyModeOf([{ ns: "ui-conversation", value: { busyEnter: "queue" } }])).toBe("queue")
    expect(busyModeOf([{ ns: "other", value: { busyEnter: "steer" } }])).toBe("queue")
    expect(busyModeOf([])).toBe("queue")
  })
})
