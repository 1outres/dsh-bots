import { describe, expect, it } from "vitest"
import { imageTypeOf } from "../src/host/bridge"
import { replyAnswer } from "../src/host/cards/answers"
import { splitMarkdown } from "../src/host/format/split"
import { botLocalpart, botUserId, inNamespace } from "../src/host/ids"
import { commandOf, messageOf, stripReplyFallback } from "../src/host/inbound"
import { registrationFile } from "../src/host/settings/queries"
import { canSend } from "../src/host/settings/rooms"
import { supportsVersion } from "../src/host/settings/versions"
import { event } from "./support"

const question = {
  id: "q",
  question: "Which?",
  options: [{ label: "Red" }, { label: "Blue" }, { label: "Green" }],
  multiSelect: false,
}

describe("Matrix text handling", () => {
  it.each([
    ["!stop", "stop"],
    ["  !STATUS ", "status"],
    ["!pending", "pending"],
    ["!help", "help"],
    ["!nope", undefined],
    ["stop", undefined],
  ])("reads %j as the command %j", (text, command) => {
    expect(commandOf(text)).toBe(command)
  })

  it("drops edits and thread messages, and strips the reply fallback", () => {
    expect(
      messageOf(
        event({
          eventId: "$1",
          content: {
            msgtype: "m.text",
            body: "x",
            "m.relates_to": { rel_type: "m.replace", event_id: "$0" },
          },
        }),
      ),
    ).toBeUndefined()
    expect(
      messageOf(
        event({
          eventId: "$1",
          content: {
            msgtype: "m.text",
            body: "x",
            "m.relates_to": { rel_type: "m.thread", event_id: "$0" },
          },
        }),
      ),
    ).toBeUndefined()
    expect(
      messageOf(event({ eventId: "$1", content: { msgtype: "m.notice", body: "x" } })),
    ).toBeUndefined()
    expect(
      messageOf(
        event({
          eventId: "$1",
          content: {
            msgtype: "m.text",
            body: "> <@a:x> quoted\n\nanswer",
            "m.relates_to": { "m.in_reply_to": { event_id: "$0" } },
          },
        }),
      ),
    ).toMatchObject({ text: "answer", replyTo: "$0" })
    expect(stripReplyFallback("plain")).toBe("plain")
  })

  it("reads a file with a caption as one attachment, and skips encrypted ones", () => {
    expect(
      messageOf(
        event({
          eventId: "$1",
          content: {
            msgtype: "m.image",
            body: "look",
            filename: "a.png",
            url: "mxc://x/y",
            info: { mimetype: "image/png", size: 3 },
          },
        }),
      ),
    ).toMatchObject({
      text: "look",
      media: { url: "mxc://x/y", name: "a.png", mediaType: "image/png", size: 3 },
    })
    expect(
      messageOf(
        event({
          eventId: "$1",
          content: { msgtype: "m.file", body: "a", url: "mxc://x/y", file: {} },
        }),
      ),
    ).toBeUndefined()
  })

  it.each([
    ["2", { kind: "choose", labels: ["Blue"] }],
    ["-", { kind: "skip" }],
    ["1,3", { kind: "write", text: "1,3" }],
    ["purple", { kind: "write", text: "purple" }],
    ["9", { kind: "write", text: "9" }],
  ])("reads the reply %j to a one-choice question", (text, answer) => {
    expect(replyAnswer(question, text)).toEqual(answer)
  })

  it("reads several numbers for a several-choice question", () => {
    expect(replyAnswer({ ...question, multiSelect: true }, "1, 3")).toEqual({
      kind: "choose",
      labels: ["Red", "Green"],
    })
  })

  it("splits long Markdown at the limit, reopening a code block", () => {
    const text = `intro\n\n\`\`\`ts\n${"line\n".repeat(40)}\`\`\``
    const chunks = splitMarkdown(text, 80)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(80)
    expect(chunks[1]?.startsWith("```")).toBe(true)
  })

  it("names bot users inside the prefix's namespace", () => {
    expect(botUserId("dshbots", "AB12", "example.org")).toBe("@dshbots_ab12:example.org")
    expect(botLocalpart("dshbots", "x y")).toBe("dshbots_x-y")
    expect(inNamespace("@dshbots_ab:example.org", "dshbots")).toBe(true)
    expect(inNamespace("@dshbots:example.org", "dshbots")).toBe(true)
    expect(inNamespace("@dshbotsx:example.org", "dshbots")).toBe(false)
  })

  it("writes the registration file with the prefix and the escaped server name, never a token", () => {
    const file = registrationFile("bots", "matrix.example.org")
    expect(file).toContain("sender_localpart: bots")
    expect(file).toContain('regex: "@bots_.*:matrix\\.example\\.org"')
    expect(file).toContain("as_token: <as_token>")
    expect(registrationFile("bots", undefined)).toContain("<server_name>")
  })

  it("needs Client-Server API v1.11 or later", () => {
    expect(supportsVersion(["v1.10", "v1.11"])).toBe(true)
    expect(supportsVersion(["r0.6.1", "v1.10"])).toBe(false)
    expect(supportsVersion(["v2.0"])).toBe(true)
  })

  it("tells images from other files by their bytes", () => {
    expect(imageTypeOf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]))).toBe("image/png")
    expect(imageTypeOf(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toBe("image/jpeg")
    expect(imageTypeOf(new TextEncoder().encode("hello world"))).toBeUndefined()
  })

  it("reads from the power levels whether the bot may pin", () => {
    expect(
      canSend({ users: { "@b:x": 0 }, state_default: 50 }, "@b:x", "m.room.pinned_events"),
    ).toBe(false)
    expect(
      canSend({ users: { "@b:x": 100 }, state_default: 50 }, "@b:x", "m.room.pinned_events"),
    ).toBe(true)
    expect(canSend(undefined, "@b:x", "m.room.pinned_events")).toBe(true)
  })
})
