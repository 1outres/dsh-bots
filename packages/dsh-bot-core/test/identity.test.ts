import { describe, expect, it } from "vitest"
import { botOfIdentity, createSessionIdentity } from "../src/host/preset/identity"

interface FakeAgent {
  id: string
  session: { header: { agentPreset?: string; parentSession?: string } }
}

function setup(recordedSessions: Record<string, string> = {}) {
  const live = new Map<string, FakeAgent>()
  const identity = createSessionIdentity<FakeAgent>({
    isBot: (botId) => botId === "x" || botId === "y",
    recorded: (sessionId) => recordedSessions[sessionId],
    agent: (sessionId) => live.get(sessionId),
  })
  const agent = (id: string, header: FakeAgent["session"]["header"], running = true) => {
    const created: FakeAgent = { id, session: { header } }
    if (running) live.set(id, created)
    return created
  }
  return { identity, agent, live }
}

describe("createSessionIdentity", () => {
  it("names the bot of a session whose header names its preset", () => {
    const { identity, agent } = setup()
    expect(identity(agent("s1", { agentPreset: "bot-x" }))).toEqual({ kind: "bot", botId: "x" })
    expect(identity(agent("w1", { agentPreset: "standard" }))).toEqual({ kind: "none" })
    // A preset id of no bot of this bot-core.
    expect(identity(agent("z1", { agentPreset: "bot-z" }))).toEqual({ kind: "none" })
  })

  it("never makes a Workspace Agent's subagent a bot's, whatever preset its header names", () => {
    const { identity, agent } = setup()
    agent("w1", { agentPreset: "standard" })
    const child = agent("c1", { agentPreset: "bot-x", parentSession: "w1" })
    expect(identity(child)).toEqual({ kind: "none" })
    expect(botOfIdentity(identity(child))).toBeUndefined()
    // Nor a grandchild under it.
    const grandchild = agent("g1", { agentPreset: "bot-x", parentSession: "c1" })
    expect(identity(grandchild)).toEqual({ kind: "none" })
  })

  it("gives a bot's subagent the parent's bot, even when it names another bot's preset", () => {
    const { identity, agent } = setup()
    agent("s1", { agentPreset: "bot-x" })
    expect(identity(agent("c1", { agentPreset: "bot-x", parentSession: "s1" }))).toEqual({
      kind: "bot",
      botId: "x",
    })
    expect(identity(agent("c2", { agentPreset: "bot-y", parentSession: "s1" }))).toEqual({
      kind: "bot",
      botId: "x",
    })
    expect(identity(agent("c3", { agentPreset: "standard", parentSession: "s1" }))).toEqual({
      kind: "bot",
      botId: "x",
    })
  })

  it("ignores a record of the subagent itself while its parent is live", () => {
    const { identity, agent } = setup({ c1: "x" })
    agent("w1", { agentPreset: "standard" })
    expect(identity(agent("c1", { agentPreset: "bot-x", parentSession: "w1" }))).toEqual({
      kind: "none",
    })
  })

  it("names the bot of a fork bot-core recorded, whatever its header names", () => {
    const { identity, agent } = setup({ f1: "x" })
    expect(identity(agent("f1", { agentPreset: "standard" }))).toEqual({ kind: "bot", botId: "x" })
    expect(identity(agent("f2", {}))).toEqual({ kind: "none" })
  })

  it("fails closed for a subagent whose parent is not live: unverified unless recorded", () => {
    const { identity, agent } = setup({ r1: "x" })
    const orphan = agent("c1", { agentPreset: "bot-x", parentSession: "gone" })
    expect(identity(orphan)).toMatchObject({
      kind: "unverified",
      reason: expect.stringContaining('bot "x"'),
    })
    expect(botOfIdentity(identity(orphan))).toBeUndefined()
    // bot-core recorded it as the bot's: that record decides.
    expect(identity(agent("r1", { agentPreset: "bot-x", parentSession: "gone" }))).toEqual({
      kind: "bot",
      botId: "x",
    })
    // A header naming no bot preset: no bot's (a bot preset is locked down by isolation).
    expect(identity(agent("c2", { agentPreset: "standard", parentSession: "gone" }))).toEqual({
      kind: "none",
    })
    // Its own subagents stay unverified.
    expect(identity(agent("g1", { agentPreset: "bot-x", parentSession: "c1" }))).toMatchObject({
      kind: "unverified",
    })
  })

  it("does not loop on a cyclic parent chain", () => {
    const { identity, agent } = setup()
    agent("a", { agentPreset: "bot-x", parentSession: "b" })
    const b = agent("b", { agentPreset: "bot-x", parentSession: "a" })
    expect(identity(b)).toMatchObject({ kind: "unverified" })
  })
})
