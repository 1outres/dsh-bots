import { describe, expect, it } from "vitest"
import type { BotChannelOutput } from "../src/contract"
import { createTurnSilence, turnBoundaryOf } from "../src/host/channels/silence"
import { createSilencer } from "../src/host/channels/stay-silent"
import { mainFeed } from "./channels-support"

describe("turnBoundaryOf", () => {
  it("reads turn starts and ends, nothing else", () => {
    expect(turnBoundaryOf({ type: "turn/start", data: { turn: 2 } })).toEqual({
      edge: "start",
      turn: 2,
    })
    expect(
      turnBoundaryOf({ type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } }),
    ).toEqual({ edge: "end", turn: 2 })
    expect(turnBoundaryOf({ type: "step/start", data: { turn: 2, step: 1 } })).toBe(undefined)
  })
})

describe("createTurnSilence", () => {
  it("silences the running turn only, until it ends", () => {
    const silence = createTurnSilence()
    expect(silence.silence("s")).toBe(undefined)
    expect(silence.isSilent("s")).toBe(false)
    silence.follow("s", { edge: "start", turn: 1 })
    expect(silence.isSilent("s")).toBe(false)
    expect(silence.silence("s")).toBe(1)
    expect(silence.silence("s")).toBe(1)
    expect(silence.isSilent("s")).toBe(true)
    expect(silence.isSilent("other")).toBe(false)
    silence.follow("s", { edge: "end", turn: 1 })
    expect(silence.isSilent("s")).toBe(false)
    expect(silence.silence("s")).toBe(undefined)
  })

  it("starts every turn not silent, and ignores the end of another turn", () => {
    const silence = createTurnSilence()
    silence.follow("s", { edge: "start", turn: 1 })
    silence.silence("s")
    silence.follow("s", { edge: "start", turn: 2 })
    expect(silence.isSilent("s")).toBe(false)
    silence.silence("s")
    silence.follow("s", { edge: "end", turn: 1 })
    expect(silence.isSilent("s")).toBe(true)
  })
})

describe("stay_silent", () => {
  function setup(refusal?: string) {
    const silence = createTurnSilence()
    const silencer = createSilencer({
      refusal: (_botId, token) => refusal ?? (token === "t" ? undefined : "stale revision"),
      silence,
    })
    return { silence, silencer }
  }

  it("silences the Main session's running turn", () => {
    const { silence, silencer } = setup()
    silence.follow("main-a", { edge: "start", turn: 4 })
    expect(silencer.staySilent("a", "t", { agentId: "main-a" })).toEqual({ turn: 4 })
    expect(silence.isSilent("main-a")).toBe(true)
  })

  it("refuses another session or revision, and a session with no running turn", () => {
    const refused = setup("Main session only")
    refused.silence.follow("other", { edge: "start", turn: 1 })
    expect(() => refused.silencer.staySilent("a", "t", { agentId: "other" })).toThrow(
      "Main session only",
    )
    expect(refused.silence.isSilent("other")).toBe(false)
    const { silencer } = setup()
    expect(() => silencer.staySilent("a", "old", { agentId: "main-a" })).toThrow("stale revision")
    expect(() => silencer.staySilent("a", "t", { agentId: "main-a" })).toThrow(
      "no turn of the bot's Main session is running",
    )
  })

  it("keeps the rest of the turn off the channels, and the next turn on them", () => {
    const silence = createTurnSilence()
    const silencer = createSilencer({ refusal: () => undefined, silence })
    const published: BotChannelOutput[] = []
    const feed = mainFeed({
      botOfMainSession: () => "a",
      isSilent: (sessionId) => silence.isSilent(sessionId),
      isMaintenance: () => false,
      publish: (_botId, output) => published.push(output),
    })
    const event = (type: string, data: unknown) => {
      const value = { type, data }
      const boundary = turnBoundaryOf(value)
      if (boundary !== undefined) silence.follow("main-a", boundary)
      feed.sessionEvent("main-a", value)
    }
    const reply = (id: string) => ({ message: { id, content: [{ type: "text", text: id }] } })
    event("turn/start", { turn: 1 })
    event("assistant/message", reply("early"))
    silencer.staySilent("a", "t", { agentId: "main-a" })
    event("assistant/message", reply("late"))
    event("turn/end", { turn: 1, reason: { kind: "completed" } })
    event("turn/start", { turn: 2 })
    event("assistant/message", reply("next"))
    expect(
      published.map((output) => (output.kind === "reply" ? output.reply.id : output.kind)),
    ).toEqual(["turn", "early", "turn", "turn", "next"])
  })
})

describe("a reply sent with stay_silent", () => {
  function setup() {
    const silence = createTurnSilence()
    const silencer = createSilencer({ refusal: () => undefined, silence })
    const published: string[] = []
    const feed = mainFeed({
      botOfMainSession: () => "a",
      isSilent: (sessionId) => silence.isSilent(sessionId),
      publish: (_botId, output) =>
        published.push(output.kind === "reply" ? output.reply.text : output.kind),
    })
    let turn = 0
    const event = (type: string, data: unknown) => {
      const value = { type, data }
      const boundary = turnBoundaryOf(value)
      if (boundary !== undefined) silence.follow("main-a", boundary)
      feed.sessionEvent("main-a", value)
    }
    const start = () => {
      turn += 1
      event("turn/start", { turn })
    }
    const end = (kind = "completed") => event("turn/end", { turn, reason: { kind } })
    const say = (id: string, text: string, ...calls: readonly string[]) =>
      event("assistant/message", {
        turn,
        message: {
          id,
          content: [
            { type: "text", text },
            ...calls.map((call) => ({ type: "tool-call", id: call, name: "stay_silent" })),
          ],
        },
      })
    const result = (callId: string, isError: boolean, of = turn) =>
      event("tool/result", { turn: of, message: { toolCallId: callId, isError } })
    const staySilent = (callId: string) => {
      silencer.staySilent("a", "t", { agentId: "main-a" })
      result(callId, false)
    }
    return { published, start, end, say, result, staySilent }
  }

  it("is not delivered once the call succeeds", () => {
    const { published, start, end, say, staySilent } = setup()
    start()
    say("a1", "Routine direct debit confirmation; nothing to tell.", "s1")
    expect(published).toEqual(["turn"])
    staySilent("s1")
    say("a2", "after")
    end()
    expect(published).toEqual(["turn", "turn"])
  })

  it("is delivered when the call fails, in its place", () => {
    const { published, start, end, say, result } = setup()
    start()
    say("a1", "kept", "s1")
    say("a2", "later")
    expect(published).toEqual(["turn"])
    result("s1", true)
    say("a3", "last")
    end()
    expect(published).toEqual(["turn", "kept", "later", "last", "turn"])
  })

  it("leaves what earlier messages of the turn said delivered", () => {
    const { published, start, end, say, staySilent } = setup()
    start()
    say("a0", "earlier")
    say("a1", "same", "s1")
    staySilent("s1")
    end()
    expect(published).toEqual(["turn", "earlier", "turn"])
  })

  it("is not delivered when one of its calls succeeds and another fails", () => {
    const { published, start, end, say, result, staySilent } = setup()
    start()
    say("a1", "same", "s1", "s2")
    result("s1", true)
    expect(published).toEqual(["turn"])
    staySilent("s2")
    end()
    expect(published).toEqual(["turn", "turn"])
  })

  it("is delivered before the turn's end when the call never returned", () => {
    const { published, start, end, say } = setup()
    start()
    say("a1", "pending", "s1")
    end("max-tokens")
    expect(published).toEqual(["turn", "pending", "turn"])
  })

  it("is forgotten by the next turn", () => {
    const { published, start, end, say, result } = setup()
    start()
    say("a1", "stale", "s1")
    start()
    result("s1", true, 1)
    say("b1", "fresh")
    end()
    expect(published).toEqual(["turn", "turn", "fresh", "turn"])
  })
})
