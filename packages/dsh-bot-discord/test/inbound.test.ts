import { describe, expect, it } from "vitest"
import { createDmCursor } from "../src/host/cursor"
import { downloadAttachment, type FetchUrl } from "../src/host/download"
import { hasContent, inboundMessageOf, isAllowedDirectMessage } from "../src/host/inbound"
import { ALLOWED, author, directMessage, OTHER } from "./support"

const allowed = new Set([ALLOWED])

describe("isAllowedDirectMessage", () => {
  it("accepts what an allowed person writes in a DM", () => {
    expect(isAllowedDirectMessage(directMessage(), allowed, "self")).toBe(true)
    expect(isAllowedDirectMessage(directMessage({ kind: "reply" }), allowed, "self")).toBe(true)
  })

  it("refuses servers, system messages, bots, itself and other users", () => {
    for (const message of [
      directMessage({ guildId: "g1" }),
      directMessage({ kind: "other" }),
      directMessage({ author: author(ALLOWED, true) }),
      directMessage({ author: author(OTHER) }),
    ]) {
      expect(isAllowedDirectMessage(message, allowed, "self")).toBe(false)
    }
    expect(isAllowedDirectMessage(directMessage(), allowed, ALLOWED)).toBe(false)
  })
})

describe("inbound messages", () => {
  it("count text or attachments as content, and name each attachment's size and type", () => {
    const attachment = {
      name: "a.png",
      url: "https://cdn.discordapp.com/attachments/1/2/a.png",
      size: 9,
      contentType: "image/png",
    }
    expect(hasContent(directMessage({ content: " ", attachments: [attachment] }))).toBe(true)
    expect(hasContent(directMessage({ content: " " }))).toBe(false)
    const message = inboundMessageOf(
      directMessage({ content: "see", attachments: [attachment] }),
      async () => {
        throw new Error("not read")
      },
    )
    expect(message).toMatchObject({
      place: { kind: "direct" },
      sender: { id: ALLOWED, displayName: "User 11", handle: "user11", bot: false },
      sentAt: 1_700_000_000_000,
      text: "see",
      attachments: [{ name: "a.png", bytes: 9, mediaType: "image/png" }],
    })
  })
})

const body =
  (...chunks: number[][]): FetchUrl =>
  async () => ({
    ok: true,
    status: 200,
    body: (async function* () {
      for (const chunk of chunks) yield new Uint8Array(chunk)
    })(),
  })

const CDN = "https://cdn.discordapp.com/attachments/1/2/a.png?ex=1"

describe("downloadAttachment", () => {
  it("fetches only HTTPS attachments of Discord's CDN, refusing redirects", async () => {
    const signal = new AbortController().signal
    const requested: { url: string; redirect: string }[] = []
    const fetch: FetchUrl = async (url, init) => {
      requested.push({ url, redirect: init.redirect })
      return body([1])(url, init)
    }
    for (const url of [
      "http://cdn.discordapp.com/attachments/1/2/a.png",
      "https://cdn.discordapp.com:8443/a.png",
      "https://user@cdn.discordapp.com/a.png",
      "https://cdn.discordapp.com.evil.example/a.png",
      "https://169.254.169.254/latest/meta-data",
      "file:///etc/passwd",
      "not a url",
    ]) {
      await expect(downloadAttachment(fetch, url, 10, signal)).rejects.toThrow("Discord's CDN")
    }
    expect(requested).toEqual([])
    await downloadAttachment(fetch, CDN, 10, signal)
    await downloadAttachment(
      fetch,
      "https://media.discordapp.net/attachments/1/2/b.png",
      10,
      signal,
    )
    expect(requested.map((request) => request.redirect)).toEqual(["error", "error"])
  })

  it("joins the chunks, stops past the limit and reports HTTP failures", async () => {
    const signal = new AbortController().signal
    expect(await downloadAttachment(body([1, 2], [3]), CDN, 3, signal)).toEqual(
      new Uint8Array([1, 2, 3]),
    )
    await expect(downloadAttachment(body([1, 2], [3]), CDN, 2, signal)).rejects.toThrow(
      "larger than 2",
    )
    await expect(
      downloadAttachment(async () => ({ ok: false, status: 404, body: null }), CDN, 2, signal),
    ).rejects.toThrow("HTTP 404")
  })
})

describe("DM cursor", () => {
  it("advances per channel by snowflake order, never back", () => {
    const cursor = createDmCursor()
    expect(cursor.advance("a", "1002")).toBe(true)
    expect(cursor.advance("a", "1002")).toBe(false)
    expect(cursor.advance("a", "999")).toBe(false)
    expect(cursor.advance("a", "10000")).toBe(true)
    expect(cursor.advance("b", "5")).toBe(true)
    expect(cursor.positions()).toEqual([
      ["a", "10000"],
      ["b", "5"],
    ])
  })
})
