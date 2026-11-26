import { describe, expect, it } from "vitest"
import { createDmCursor } from "../src/host/cursor"
import { downloadAttachment, type FetchUrl } from "../src/host/download"
import type { DiscordHome } from "../src/host/home"
import { hasContent, inboundMessageOf, isHomeMessage } from "../src/host/inbound"
import {
  ALLOWED,
  author,
  channelMessage,
  directMessage,
  GUILD,
  HOME_CHANNEL,
  OTHER,
} from "./support"

const dmHome: DiscordHome = { kind: "dm", owner: ALLOWED }
const channelHome: DiscordHome = { kind: "channel", guildId: GUILD, channelId: HOME_CHANNEL }

describe("isHomeMessage", () => {
  it("accepts what the owner writes in a DM home", () => {
    expect(isHomeMessage(directMessage(), dmHome, "self")).toBe(true)
    expect(isHomeMessage(directMessage({ kind: "reply" }), dmHome, "self")).toBe(true)
  })

  it("refuses, in a DM home, servers, system messages, bots, itself and anyone but the owner", () => {
    for (const message of [
      channelMessage(),
      directMessage({ kind: "other" }),
      directMessage({ author: author(ALLOWED, true) }),
      directMessage({ author: author(OTHER) }),
    ]) {
      expect(isHomeMessage(message, dmHome, "self")).toBe(false)
    }
    expect(isHomeMessage(directMessage(), dmHome, ALLOWED)).toBe(false)
  })

  it("accepts anyone in the home channel, and nothing elsewhere", () => {
    expect(isHomeMessage(channelMessage({ author: author(OTHER) }), channelHome, "self")).toBe(true)
    for (const message of [
      directMessage(),
      channelMessage({ channelId: "555555555555555555" }),
      channelMessage({ guildId: "666666666666666666" }),
      channelMessage({ author: author(OTHER, true) }),
      channelMessage({ kind: "other" }),
    ]) {
      expect(isHomeMessage(message, channelHome, "self")).toBe(false)
    }
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
    expect(
      inboundMessageOf(channelMessage(), async () => ({ ok: false, status: 404, body: null }))
        .place,
    ).toEqual({
      kind: "channel",
      channel: "general",
      server: "Team",
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
