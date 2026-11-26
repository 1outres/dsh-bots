import { describe, expect, it } from "vitest"
import type { BotChannelCapabilities, BotChannelOutput } from "../src/contract"
import { checkChannelCapabilities, commandsOf } from "../src/host/channels/capabilities"
import { createChannelOutlets } from "../src/host/channels/outlets"
import { CAPABILITIES, settle } from "./channels-support"

function connection(fail?: (output: BotChannelOutput) => Error | undefined) {
  const received: BotChannelOutput[] = []
  let release: () => void = () => {}
  let hold = false
  return {
    received,
    holdNext() {
      hold = true
    },
    release: () => release(),
    connection: {
      async receive(output: BotChannelOutput) {
        if (hold) {
          hold = false
          await new Promise<void>((resolve) => {
            release = resolve
          })
        }
        const error = fail?.(output)
        if (error !== undefined) throw error
        received.push(output)
      },
      async close() {},
    },
  }
}

const reply = (text: string): BotChannelOutput => ({
  kind: "reply",
  reply: { id: text, text, interrupted: false },
})
const file = (bytes: number) => ({ name: "a.txt", data: new Uint8Array(bytes) })

describe("channel outlets", () => {
  it("send each connection its outputs in order, one at a time, only what it carries", async () => {
    const outlets = createChannelOutlets({ warn: () => {} })
    const full = connection()
    const plain = connection()
    const none: BotChannelCapabilities = { turns: false, interactions: [], commands: [] }
    outlets.attach(
      "a",
      { channelId: "full", capabilities: CAPABILITIES, connection: full.connection },
      new AbortController().signal,
    )
    outlets.attach(
      "a",
      { channelId: "plain", capabilities: none, connection: plain.connection },
      new AbortController().signal,
    )
    full.holdNext()
    outlets.publish("a", reply("one"))
    outlets.publish("a", { kind: "turn", turn: { phase: "started" } })
    outlets.publish("a", {
      kind: "interaction-opened",
      interaction: { id: "p", kind: "plan-review", question: "Go?", plan: "x" },
    })
    outlets.publish("b", reply("other bot"))
    await settle()
    expect(full.received).toEqual([])
    full.release()
    await settle()
    expect(full.received.map((output) => output.kind)).toEqual(["reply", "turn"])
    expect(plain.received.map((output) => output.kind)).toEqual(["reply"])
  })

  it("stop sending once a connection's signal aborts, and warn about failures", async () => {
    const warnings: string[] = []
    const outlets = createChannelOutlets({ warn: (message) => warnings.push(message) })
    const target = connection((output) =>
      output.kind === "reply" && output.reply.text === "bad" ? new Error("down") : undefined,
    )
    const controller = new AbortController()
    outlets.attach(
      "a",
      { channelId: "c", capabilities: CAPABILITIES, connection: target.connection },
      controller.signal,
    )
    outlets.publish("a", reply("bad"))
    outlets.publish("a", reply("good"))
    await settle()
    controller.abort()
    outlets.publish("a", reply("late"))
    await settle()
    expect(target.received.map((output) => output.kind === "reply" && output.reply.text)).toEqual([
      "good",
    ])
    expect(warnings).toEqual(['bot-core: channel "c" of bot "a" could not show a reply: down'])
  })

  it("send a file to every connection that takes it, with each one's outcome", async () => {
    const outlets = createChannelOutlets({ warn: () => {} })
    const small: BotChannelCapabilities = { ...CAPABILITIES, files: { maxBytes: 10 } }
    const broken = connection(() => new Error("upload refused"))
    const signal = new AbortController().signal
    outlets.attach(
      "a",
      { channelId: "big", capabilities: CAPABILITIES, connection: connection().connection },
      signal,
    )
    outlets.attach(
      "a",
      { channelId: "small", capabilities: small, connection: connection().connection },
      signal,
    )
    outlets.attach(
      "a",
      { channelId: "broken", capabilities: CAPABILITIES, connection: broken.connection },
      signal,
    )
    outlets.attach(
      "a",
      {
        channelId: "text",
        capabilities: { ...CAPABILITIES, files: undefined },
        connection: connection().connection,
      },
      signal,
    )
    expect(outlets.fileTargets("a")).toEqual([
      { channelId: "big", maxBytes: 100 },
      { channelId: "small", maxBytes: 10 },
      { channelId: "broken", maxBytes: 100 },
    ])
    expect(await outlets.sendFile("a", file(50))).toEqual([
      { channelId: "big", outcome: "sent" },
      { channelId: "small", outcome: "too-large", limit: 10 },
      { channelId: "broken", outcome: "failed", message: "upload refused" },
    ])
  })
})

describe("channel capabilities", () => {
  it("accept a valid declaration and name the commands' specs in its order", () => {
    expect(() => checkChannelCapabilities({ id: "chat" }, CAPABILITIES)).not.toThrow()
    expect(commandsOf(CAPABILITIES).map((command) => command.id)).toEqual(["status", "stop"])
    expect(commandsOf(CAPABILITIES)[0]?.description.en).toContain("busy")
  })

  it("refuse unknown or repeated commands and interactions and invalid limits", () => {
    const check = (value: unknown) => () => checkChannelCapabilities({ id: "chat" }, value)
    expect(check(undefined)).toThrow("missing")
    expect(check({ ...CAPABILITIES, commands: ["reboot"] })).toThrow('"reboot"')
    expect(check({ ...CAPABILITIES, commands: ["stop", "stop"] })).toThrow("twice")
    expect(check({ ...CAPABILITIES, interactions: ["poll"] })).toThrow('"poll"')
    expect(check({ ...CAPABILITIES, files: { maxBytes: 0 } })).toThrow("files.maxBytes")
    expect(check({ ...CAPABILITIES, attachments: { maxCount: 0, maxBytes: 1 } })).toThrow(
      "maxCount",
    )
    expect(check({ ...CAPABILITIES, turns: "yes" })).toThrow("turns")
  })

  it("take a profile of the name, the avatar or both, and nothing else", () => {
    const check = (profile: unknown) => () =>
      checkChannelCapabilities({ id: "chat" }, { ...CAPABILITIES, profile })
    expect(check({ name: true, avatar: false })).not.toThrow()
    expect(check({ name: true, avatar: true })).not.toThrow()
    expect(check({ name: false, avatar: false })).toThrow("the name, the avatar or both")
    expect(check({ name: true })).toThrow("profile.name and profile.avatar")
    expect(check(true)).toThrow("profile must name")
  })
})
