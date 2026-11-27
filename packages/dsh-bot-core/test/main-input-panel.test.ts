import { describe, expect, it } from "vitest"
import type { BotCommandOutcome, BotDeliveryMode } from "../src/contract"
import type { MainDeliveryDeps } from "../src/host/channels/delivery"
import { composePrompt, type PromptPart } from "../src/host/channels/inbound"
import { createMainInputPanel, WEB_INPUT_SOURCE_ID } from "../src/host/main-input/panel"
import { createInputStaging } from "../src/host/main-input/staging"
import type { MainInputLimits } from "../src/shared/main-input"

const OWNER = { kind: "owner" }
const LIMITS: MainInputLimits = {
  maxCount: 10,
  maxFileBytes: 1024,
  maxMessageBytes: 2048,
  chunkBytes: 512,
  images: {
    mediaTypes: ["image/png"],
    maxImageBytes: 1024,
    maxImagesPerMessage: 4,
    maxMessageImageBytes: 2048,
  },
}

function setup() {
  const prompts: { sessionId: string; content: readonly PromptPart[]; mode: BotDeliveryMode }[] = []
  const admitted: string[] = []
  const folders: string[] = []
  let running = false
  let main: string | undefined = "main-a"
  const stops: string[] = []
  const delivery: MainDeliveryDeps = {
    activityOf: () => (running ? "running" : "idle"),
    busyMode: () => "steer",
    compose: (request, signal) =>
      composePrompt(
        {
          imageLimits: () => LIMITS.images,
          limits: { maxCount: 10, maxFileBytes: 1024, maxMessageBytes: 2048 },
          inboxOf: () => ({
            root: "/w/.inbox",
            writer: {
              async createFolder(_root, base) {
                folders.push(base)
                return `/w/.inbox/${base}`
              },
              async writeFile(folder, name) {
                return `${folder}/${name}`
              },
            },
          }),
          encodeBase64: (data) => `b64:${data.byteLength}`,
        },
        {
          botId: request.botId,
          source: request.source.id,
          capability: request.source.attachments,
          message: request.content,
          header: request.header,
        },
        signal,
      ),
    async prompt(request) {
      prompts.push(request)
    },
    admit: (botId, work) => {
      admitted.push(botId)
      return work(main)
    },
    shield: async (_botId, _sessionId, content) => ({
      ...content,
      text: content.text.replace("secret", "[withheld]"),
    }),
  }
  const staging = createInputStaging({
    rules: () => ({ ttlMs: 60_000, chunkBytes: 512, check: () => undefined }),
    now: () => 0,
    newId: () => "s1",
  })
  const panel = createMainInputPanel({
    delivery,
    staging,
    known: (botId) => botId === "a",
    mainSessionOf: () => main,
    activityOf: () => (running ? "running" : "idle"),
    limits: () => LIMITS,
    async stop(botId): Promise<BotCommandOutcome> {
      stops.push(botId)
      return { ok: true, result: { command: "stop", outcome: running ? "stopped" : "idle" } }
    },
    decodeBase64: (data) => new Uint8Array(Buffer.from(data, "base64")),
    now: () => Date.UTC(2026, 10, 26, 14, 0, 0),
    signal: new AbortController().signal,
  })
  return {
    panel,
    prompts,
    admitted,
    folders,
    stops,
    setRunning: (value: boolean) => {
      running = value
    },
    setMain: (value: string | undefined) => {
      main = value
    },
  }
}

describe("Main input from the Web UI", () => {
  it("delivers the owner's text through the Main's input gate, without a channel header", async () => {
    const { panel, prompts, admitted } = setup()
    expect(await panel.send(OWNER, "a", { text: "hello secret", attachments: [] })).toEqual({
      sent: true,
      sessionId: "main-a",
      mode: "queue",
    })
    expect(admitted).toEqual(["a"])
    expect(prompts).toEqual([
      {
        botId: "a",
        sessionId: "main-a",
        content: [{ type: "text", text: "hello [withheld]" }],
        mode: "queue",
      },
    ])
  })

  it("uses the busy preference while the Main runs, as channel messages do", async () => {
    const { panel, prompts, setRunning } = setup()
    setRunning(true)
    expect(await panel.send(OWNER, "a", { text: "more", attachments: [] })).toMatchObject({
      mode: "steer",
    })
    expect(prompts[0]?.mode).toBe("steer")
  })

  it("saves a staged file in the bot's inbox and passes a staged image as an image", async () => {
    const { panel, prompts, folders } = setup()
    expect(
      panel.stage(OWNER, "a", {
        draft: "d",
        name: "r.pdf",
        mediaType: "application/pdf",
        bytes: 3,
      }),
    ).toEqual({ staged: true, attachmentId: "s1" })
    expect(panel.append(OWNER, "a", "s1", 0, Buffer.from("abc").toString("base64"))).toEqual({
      appended: true,
      received: 3,
      complete: true,
    })
    expect(await panel.send(OWNER, "a", { text: "", attachments: ["s1"] })).toMatchObject({
      sent: true,
    })
    expect(folders).toEqual([`20261126T140000Z-${WEB_INPUT_SOURCE_ID}`])
    expect(prompts[0]?.content).toEqual([
      {
        type: "text",
        text: "Attached files, saved in your workspace:\n- /w/.inbox/20261126T140000Z-web/r.pdf (3 B)",
      },
    ])
    expect(await panel.send(OWNER, "a", { text: "again", attachments: ["s1"] })).toMatchObject({
      sent: false,
      failure: { code: "unknown-attachment" },
    })
  })

  it("passes an image alone as an image part with no text", async () => {
    const { panel, prompts } = setup()
    panel.stage(OWNER, "a", { draft: "d", name: "p.png", mediaType: "image/png", bytes: 2 })
    panel.append(OWNER, "a", "s1", 0, Buffer.from("xy").toString("base64"))
    await panel.send(OWNER, "a", { text: "", attachments: ["s1"] })
    expect(prompts[0]?.content).toEqual([
      { type: "image", mediaType: "image/png", data: "b64:2", name: "p.png" },
    ])
  })

  it("keeps the staged files when the delivery fails, so the owner can send again", async () => {
    const { panel, setMain } = setup()
    panel.stage(OWNER, "a", { draft: "d", name: "r.txt", bytes: 0 })
    setMain(undefined)
    expect(await panel.send(OWNER, "a", { text: "x", attachments: ["s1"] })).toMatchObject({
      sent: false,
      failure: { code: "no-main-session" },
    })
    setMain("main-a")
    expect(await panel.send(OWNER, "a", { text: "x", attachments: ["s1"] })).toMatchObject({
      sent: true,
    })
  })

  it("takes nothing from a caller who is not the owner, nor for an unknown bot", async () => {
    const { panel, prompts, stops } = setup()
    const guest = { kind: "guest" }
    expect(await panel.send(guest, "a", { text: "x", attachments: [] })).toMatchObject({
      failure: { code: "not-owner" },
    })
    expect(await panel.send(undefined, "a", { text: "x", attachments: [] })).toMatchObject({
      failure: { code: "not-owner" },
    })
    expect(panel.stage(guest, "a", { draft: "d", name: "x", bytes: 1 })).toMatchObject({
      staged: false,
    })
    expect(await panel.send(OWNER, "zz", { text: "x", attachments: [] })).toMatchObject({
      failure: { code: "unknown-bot" },
    })
    expect(await panel.stop(guest, "a")).toMatchObject({ ok: false })
    expect(() => panel.state(guest, "a")).toThrow()
    expect(prompts).toEqual([])
    expect(stops).toEqual([])
  })

  it("stops the running turn through the bot's stop command", async () => {
    const { panel, stops, setRunning } = setup()
    expect(await panel.stop(OWNER, "a")).toEqual({ ok: true, outcome: "idle" })
    setRunning(true)
    expect(await panel.stop(OWNER, "a")).toEqual({ ok: true, outcome: "stopped" })
    expect(stops).toEqual(["a", "a"])
  })

  it("reports the Main, its activity and the limits", () => {
    const { panel, setRunning, setMain } = setup()
    expect(panel.state(OWNER, "a")).toEqual({
      botId: "a",
      mainSessionId: "main-a",
      activity: "idle",
      limits: LIMITS,
    })
    setRunning(true)
    expect(panel.state(OWNER, "a").activity).toBe("running")
    setMain(undefined)
    expect(panel.state(OWNER, "a")).toEqual({ botId: "a", activity: "idle", limits: LIMITS })
  })
})
