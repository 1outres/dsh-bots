import { describe, expect, it } from "vitest"
import { workspaceRefusal } from "../src/host/managed/authority"
import { settingsTurnOf } from "../src/host/settings/authority"
import {
  createTurnParties,
  inputPartyOf,
  peerDerived,
  type TurnInput,
} from "../src/host/turns/parties"

const input = (kind: string, text = "x", extra: object = {}): TurnInput => ({
  content: [{ type: "text", text }],
  source: { kind, ...extra },
})

const event = (type: string, data: unknown) => ({ type, data })

describe("where an input comes from", () => {
  it("follows the table of the spec", () => {
    expect(inputPartyOf(input("user", "hi"))).toBe("owner")
    expect(inputPartyOf(input("user", "[Discord · DM · Ann (@ann, owner)]\nhi"))).toBe("owner")
    expect(inputPartyOf(input("user", "[Discord · DM · Bob (@bob)]\nhi"))).toBe("other")
    expect(inputPartyOf(input("user", "hi", { principal: { kind: "peer" } }))).toBe("other")
    expect(inputPartyOf(input("bot-connector-event"))).toBe("other")
    expect(inputPartyOf(input("bot-heartbeat"))).toBe("other")
    for (const kind of ["bot-peer", "bot-peer-session", "bot-peer-relay"]) {
      expect(inputPartyOf(input(kind))).toBe("peer")
    }
    for (const kind of [
      "bot-peer-status",
      "bot-session",
      "bot-schedule",
      "bot-connector",
      "bot-file",
      "bot-main",
      "bot-main-relay",
    ]) {
      expect(inputPartyOf(input(kind))).toBe("system")
    }
    for (const kind of ["runtime-context", "bot-notes", "bot-skills", "working-directory"]) {
      expect(inputPartyOf(input(kind))).toBeUndefined()
    }
  })
})

describe("the parties of a turn", () => {
  it("records the inputs and peer messages of the open turn and keeps the last one after it ends", () => {
    const parties = createTurnParties({ tracked: (sessionId) => sessionId !== "other" })
    expect(peerDerived(parties.current("m"))).toBe(true)
    parties.sessionEvent("m", event("turn/start", { turn: 1 }))
    parties.sessionEvent("m", event("user/message", input("user", "hi")))
    parties.sessionEvent("m", event("user/message", input("runtime-context")))
    expect(parties.current("m")?.inputs).toEqual(["owner"])
    expect(peerDerived(parties.current("m"))).toBe(false)
    parties.sessionEvent(
      "m",
      event("user/message", input("bot-peer", "[peer] …", { peerMessages: ["p_1"] })),
    )
    parties.sessionEvent(
      "m",
      event(
        "user/message",
        input("bot-peer-session", "[session] …", { peerMessages: ["p_1", "p_2"] }),
      ),
    )
    expect(parties.current("m")).toEqual({
      turn: 1,
      open: true,
      inputs: ["owner", "peer", "peer"],
      peerMessages: ["p_1", "p_2"],
    })
    parties.sessionEvent("m", event("turn/end", { turn: 1 }))
    expect(parties.current("m")).toBeUndefined()
    expect(parties.latest("m")?.peerMessages).toEqual(["p_1", "p_2"])
    parties.sessionEvent("other", event("turn/start", { turn: 1 }))
    expect(parties.latest("other")).toBeUndefined()
  })

  it("keeps the Workspace and bot_settings rules as they were, with peers added", () => {
    const parties = createTurnParties({ tracked: () => true })
    const turnOf = (...inputs: TurnInput[]) => {
      parties.sessionEvent("s", event("turn/start", { turn: 1 }))
      for (const each of inputs) parties.sessionEvent("s", event("user/message", each))
      return parties.current("s")
    }
    expect(workspaceRefusal(undefined)).toMatch("saw start")
    expect(workspaceRefusal(turnOf(input("user", "hi"), input("bot-session")))).toBeUndefined()
    expect(workspaceRefusal(turnOf(input("bot-connector-event")))).toMatch("someone other")
    expect(workspaceRefusal(turnOf(input("user", "hi"), input("bot-peer")))).toMatch("peer bot")
    expect(settingsTurnOf(turnOf(input("user", "hi")))).toEqual({
      startedBy: "owner",
      mixed: false,
    })
    expect(settingsTurnOf(turnOf(input("user", "hi"), input("bot-schedule")))).toEqual({
      startedBy: "owner",
      mixed: true,
    })
    expect(settingsTurnOf(turnOf(input("bot-peer")))?.startedBy).toBe("other")
    expect(settingsTurnOf(turnOf(input("runtime-context")))).toBeUndefined()
  })
})
