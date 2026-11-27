import { describe, expect, it } from "vitest"
import type { BotAttachmentCapability, BotInboundAttachment } from "../src/contract"
import { composePrompt, type ImageLimits, type InboundDeps } from "../src/host/channels/inbound"
import type { InboxWriter } from "../src/host/channels/inbox"
import { CAPABILITIES, inboundMessage } from "./channels-support"

const HEADER = "[Chat · DM · Alice (@alice)]"

const IMAGES: ImageLimits = {
  maxImageBytes: 300,
  maxImagesPerMessage: 2,
  maxMessageImageBytes: 500,
  mediaTypes: ["image/png", "image/jpeg"],
}

function attachment(
  name: string,
  bytes: number,
  mediaType?: string,
  fail?: string,
): BotInboundAttachment & { reads: number } {
  const entry = {
    name,
    bytes,
    ...(mediaType === undefined ? {} : { mediaType }),
    reads: 0,
    async read(maxBytes: number) {
      entry.reads += 1
      if (fail !== undefined) throw new Error(fail)
      return new Uint8Array(Math.min(bytes, maxBytes + 1)).fill(1)
    },
  }
  return entry
}

function setup(
  options: { images?: ImageLimits | undefined; inbox?: boolean; failWrite?: string } = {},
) {
  const writes: string[] = []
  const writer: InboxWriter = {
    async createFolder(root, base) {
      writes.push(`mkdir ${root}/${base}`)
      return `${root}/${base}`
    },
    async writeFile(folder, name, data) {
      if (options.failWrite !== undefined) throw new Error(options.failWrite)
      writes.push(`write ${folder}/${name} ${data.byteLength}`)
      return `${folder}/${name}`
    },
  }
  const deps: InboundDeps = {
    imageLimits: () => ("images" in options ? options.images : IMAGES),
    limits: { maxCount: 3, maxFileBytes: 400, maxMessageBytes: 700 },
    inboxOf: () => (options.inbox === false ? undefined : { root: "/w/.inbox", writer }),
    encodeBase64: (data) => `b64:${data.byteLength}`,
  }
  const compose = (
    text: string,
    attachments: readonly BotInboundAttachment[],
    channel: { readonly capability: BotAttachmentCapability | undefined } = {
      capability: CAPABILITIES.attachments,
    },
  ) =>
    composePrompt(
      deps,
      {
        botId: "a",
        source: "chat",
        capability: channel.capability,
        message: inboundMessage(text, { sentAt: Date.UTC(2026, 10, 23, 4, 45, 9), attachments }),
        header: HEADER,
      },
      new AbortController().signal,
    )
  return { compose, writes }
}

describe("composePrompt", () => {
  it("passes text alone as one text part, after the header line", async () => {
    const { compose, writes } = setup()
    expect(await compose(" hi ", [])).toEqual({
      ok: true,
      content: [{ type: "text", text: `${HEADER}\nhi` }],
      images: 0,
      saved: [],
    })
    expect(writes).toEqual([])
  })

  it("passes images as image parts and saves other files in a new inbox folder", async () => {
    const { compose, writes } = setup()
    const result = await compose("look", [
      attachment("shot.png", 100, "image/png"),
      attachment("../../etc/report.pdf", 200, "application/pdf"),
      attachment("report.pdf", 10, undefined),
    ])
    expect(result).toEqual({
      ok: true,
      content: [
        { type: "image", mediaType: "image/png", data: "b64:100", name: "shot.png" },
        {
          type: "text",
          text: [
            HEADER,
            "look",
            "",
            "Attached files, saved in your workspace:",
            "- /w/.inbox/20261123T044509Z-chat/report.pdf (200 B)",
            "- /w/.inbox/20261123T044509Z-chat/report (2).pdf (10 B)",
          ].join("\n"),
        },
      ],
      images: 1,
      saved: [
        "/w/.inbox/20261123T044509Z-chat/report.pdf",
        "/w/.inbox/20261123T044509Z-chat/report (2).pdf",
      ],
    })
    expect(writes).toEqual([
      "mkdir /w/.inbox/20261123T044509Z-chat",
      "write /w/.inbox/20261123T044509Z-chat/report.pdf 200",
      "write /w/.inbox/20261123T044509Z-chat/report (2).pdf 10",
    ])
  })

  it("saves an image type DSH does not take, and every image when DSH takes none, as files", async () => {
    const bmp = await setup().compose("", [attachment("pic.bmp", 20, "image/bmp")])
    expect(bmp).toMatchObject({
      ok: true,
      images: 0,
      saved: ["/w/.inbox/20261123T044509Z-chat/pic.bmp"],
    })
    const none = await setup({ images: undefined }).compose("", [
      attachment("a.png", 20, "image/png"),
    ])
    expect(none).toMatchObject({
      ok: true,
      images: 0,
      saved: ["/w/.inbox/20261123T044509Z-chat/a.png"],
    })
  })

  it("passes images without text, with the header alone, and without touching the inbox", async () => {
    const { compose, writes } = setup({ inbox: false })
    expect(await compose("", [attachment("a.jpg", 10, "image/jpeg; charset=binary")])).toEqual({
      ok: true,
      content: [
        { type: "image", mediaType: "image/jpeg", data: "b64:10", name: "a.jpg" },
        { type: "text", text: HEADER },
      ],
      images: 1,
      saved: [],
    })
    expect(writes).toEqual([])
  })

  it("refuses before reading anything when a limit is passed", async () => {
    const cases: [string, ReturnType<typeof attachment>[], string][] = [
      ["count", [1, 2, 3, 4].map((n) => attachment(`${n}.txt`, 1)), "too-many-attachments"],
      ["file", [attachment("big.zip", 401)], "too-large"],
      ["image", [attachment("big.png", 301, "image/png")], "too-large"],
      [
        "images",
        [1, 2, 3].map((n) => attachment(`${n}.png`, 1, "image/png")),
        "too-many-attachments",
      ],
      ["image bytes", [1, 2].map((n) => attachment(`${n}.png`, 260, "image/png")), "too-large"],
      ["message", [1, 2].map((n) => attachment(`${n}.bin`, 360)), "too-large"],
    ]
    for (const [, attachments, code] of cases) {
      const result = await setup().compose("x", attachments)
      expect(result).toMatchObject({ ok: false, failure: { code } })
      expect(attachments.every((entry) => entry.reads === 0)).toBe(true)
    }
    expect(await setup().compose("x", [attachment("big.png", 301, "image/png")])).toEqual({
      ok: false,
      failure: { code: "too-large", message: 'The image "big.png" (301 B) is larger than 300 B.' },
    })
    expect(
      await setup().compose("x", [attachment("a", 1)], { capability: undefined }),
    ).toMatchObject({
      ok: false,
      failure: { code: "too-many-attachments" },
    })
  })

  it("refuses an empty message, an unreadable attachment, a missing environment and a failed save", async () => {
    expect(await setup().compose(" ", [])).toMatchObject({ ok: false, failure: { code: "empty" } })
    expect(await setup().compose("x", [attachment("a.txt", 1, undefined, "HTTP 404")])).toEqual({
      ok: false,
      failure: { code: "unreadable", message: '"a.txt" could not be read: HTTP 404' },
    })
    expect(await setup({ inbox: false }).compose("x", [attachment("a.txt", 1)])).toMatchObject({
      ok: false,
      failure: { code: "environment-unavailable" },
    })
    expect(
      await setup({ failWrite: "No space left" }).compose("x", [attachment("a.txt", 1)]),
    ).toMatchObject({
      ok: false,
      failure: { code: "save-failed", message: expect.stringContaining("No space left") },
    })
  })

  it("refuses attachments that together turn out larger than declared, saving nothing", async () => {
    const { compose, writes } = setup()
    const liars = [1, 2].map((n) => ({
      ...attachment(`${n}.bin`, 1),
      read: async () => new Uint8Array(360),
    }))
    expect(await compose("x", liars)).toMatchObject({ ok: false, failure: { code: "too-large" } })
    expect(writes).toEqual([])
  })

  it("refuses an attachment that turns out larger than declared", async () => {
    const liar = { ...attachment("a.txt", 1), read: async () => new Uint8Array(500) }
    expect(await setup().compose("x", [liar])).toMatchObject({
      ok: false,
      failure: { code: "unreadable" },
    })
  })
})
