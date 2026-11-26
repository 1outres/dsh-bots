import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, expect, it } from "vitest"
import { spaceRequestOf, writeSpaceResponse } from "../src/host/spaces/node-http"
import { contentPathOf, SPACE_LIMITS, spaceIdOf, wrapperPathOf } from "../src/shared/spaces"
import { call, type SpacesHarness, spacesHarness } from "./support/spaces"

const ID = spaceIdOf("b1", "demo")
const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  }
})

async function serve(h: SpacesHarness) {
  const server = createServer((request, response) => {
    const aborted = new AbortController()
    response.on("close", () => aborted.abort())
    void h.spaces
      .handle(spaceRequestOf(request, aborted.signal))
      .then((result) => writeSpaceResponse(request, response, result))
  })
  servers.push(server)
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function published() {
  const h = await spacesHarness({ baseUrl: "https://dsh.example/" })
  await call(h, "space_create", { space: "demo", title: "Demo" })
  h.fs.write("spaces/demo/index.html", "<p>hello</p>")
  h.fs.write("spaces/demo/app.js", "console.log(1)")
  await call(h, "space_publish", { space: "demo" })
  const origin = await serve(h)
  const frame = h.spaces.access.frame(ID)
  return { h, origin, token: frame.token, content: `${origin}${contentPathOf(frame.token)}` }
}

const IFRAME = { "sec-fetch-dest": "iframe" }

async function readEvents(response: Response, count: number) {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let text = ""
  const events: { event: string; data: unknown }[] = []
  while (events.length < count) {
    const next = await reader.read()
    if (next.done) break
    text += decoder.decode(next.value)
    for (;;) {
      const end = text.indexOf("\n\n")
      if (end < 0) break
      const block = text.slice(0, end)
      text = text.slice(end + 2)
      const event = /^event: (.*)$/m.exec(block)?.[1]
      const data = /^data: (.*)$/m.exec(block)?.[1]
      if (event !== undefined && data !== undefined) events.push({ event, data: JSON.parse(data) })
    }
  }
  await reader.cancel()
  return events
}

describe("the Spaces route", () => {
  it("serves the content in an iframe only, isolated, with ETags", async () => {
    const { content, token } = await published()
    const page = await fetch(content, { headers: IFRAME })
    expect(page.status).toBe(200)
    expect(await page.text()).toBe("<p>hello</p>")
    expect(page.headers.get("content-security-policy")).toContain(`127.0.0.1:`)
    expect(page.headers.get("content-security-policy")).toContain(`/bot-spaces/s/${token}/_dsh/`)
    expect(page.headers.get("referrer-policy")).toBe("no-referrer")
    const etag = page.headers.get("etag") as string
    expect((await fetch(content, { headers: { ...IFRAME, "if-none-match": etag } })).status).toBe(
      304,
    )
    expect((await fetch(content, { headers: { "sec-fetch-dest": "document" } })).status).toBe(404)
    expect((await fetch(content)).status).toBe(404)
    expect((await fetch(`${content}app.js`)).status).toBe(200)
    expect((await fetch(`${content}missing.js`)).status).toBe(404)
  })

  it("answers every bad token with the same 404", async () => {
    const { origin, h } = await published()
    const link = await h.spaces.manager.link(ID, {
      label: "x",
      days: 1,
      reason: null,
      issuedBy: "owner",
    })
    await h.spaces.manager.revokeLink(ID, link.hash.slice(0, 12))
    const answers = await Promise.all(
      [
        `${origin}/bot-spaces/s/${"A".repeat(43)}/`,
        `${origin}${contentPathOf(link.token)}`,
        `${origin}/bot-spaces/s/x/`,
      ].map(async (url) => {
        const response = await fetch(url, { headers: IFRAME })
        return [response.status, await response.text()]
      }),
    )
    expect(new Set(answers.map((answer) => JSON.stringify(answer))).size).toBe(1)
    expect(answers[0]?.[0]).toBe(404)
  })

  it("answers the preflight and the KV for the viewer", async () => {
    const { content, h } = await published()
    const preflight = await fetch(`${content}_dsh/kv`, { method: "OPTIONS" })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get("access-control-allow-methods")).toBe("GET, POST")
    const post = (body: unknown, base = content) =>
      fetch(`${base}_dsh/kv`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    expect((await post({ op: "set", key: "n", value: 1 })).status).toBe(200)
    expect(await (await fetch(`${content}_dsh/kv?key=n`)).json()).toEqual({ value: 1 })
    expect((await fetch(`${content}_dsh/kv?key=none`)).status).toBe(404)
    expect(await (await fetch(`${content}_dsh/kv?prefix=`)).json()).toEqual({
      entries: [{ key: "n", value: 1 }],
      truncated: false,
    })
    expect((await post({ op: "set", key: "bad key", value: 1 })).status).toBe(400)
    expect(
      (await post({ op: "set", key: "big", value: "x".repeat(SPACE_LIMITS.kvValueBytes) })).status,
    ).toBe(413)
    const { token } = await h.spaces.manager.setVisibility(ID, "public", "owner")
    const visitor = `${new URL(content).origin}${contentPathOf(token as string)}`
    const refused = await post({ op: "set", key: "v", value: 1 }, visitor)
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ error: "space/forbidden" })
    await h.spaces.manager.setVisitorWrites(ID, true)
    expect((await post({ op: "set", key: "v", value: 1 }, visitor)).status).toBe(200)
    expect(
      (
        await post(
          { op: "set", key: "v", value: "x".repeat(SPACE_LIMITS.kvVisitorValueBytes) },
          visitor,
        )
      ).status,
    ).toBe(413)
    for (let index = 1; index < SPACE_LIMITS.kvVisitorWritesPerMinute; index += 1) {
      await post({ op: "set", key: "v", value: index }, visitor)
    }
    expect((await post({ op: "set", key: "v", value: 0 }, visitor)).status).toBe(429)
  })

  it("streams KV changes, messages, revisions and gone", async () => {
    const { content, h } = await published()
    const live = await fetch(`${content}_dsh/live`)
    expect(live.headers.get("content-type")).toContain("text/event-stream")
    const events = readEvents(live, 4)
    await new Promise((done) => setTimeout(done, 20))
    await call(h, "space_kv_set", { space: "demo", entries: [{ key: "a", value: [1] }] })
    expect(await call(h, "space_post", { space: "demo", name: "hi", data: { x: 1 } })).toEqual({
      text: 'Sent "hi" to 1 open page(s).',
    })
    h.fs.write("spaces/demo/index.html", "<p>v2</p>")
    await call(h, "space_publish", { space: "demo" })
    await h.spaces.manager.discard(ID)
    expect(await events).toEqual([
      { event: "kv", data: { key: "a", value: [1] } },
      { event: "message", data: { name: "hi", data: { x: 1 } } },
      { event: "revision", data: { number: 2 } },
      { event: "gone", data: {} },
    ])
  })

  it("takes page events and bundles them into one notice", async () => {
    const { content, h } = await published()
    const send = (body: unknown) =>
      fetch(`${content}_dsh/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    expect(await (await send({ name: "vote", data: { choice: "a" } })).json()).toEqual({
      accepted: true,
    })
    expect(await (await send({ name: "vote" })).json()).toEqual({ accepted: true })
    expect(
      await (await send({ name: "big", data: "x".repeat(SPACE_LIMITS.eventDataBytes) })).json(),
    ).toEqual({ accepted: false, reason: "too-large" })
    expect((await fetch(`${content}_dsh/events`, { method: "POST", body: "{}" })).status).toBe(415)
    h.flush()
    expect(h.queued).toHaveLength(1)
    expect(h.queued[0]?.space).toEqual({ spaceId: ID, public: false, events: 2 })
    expect(h.queued[0]?.text).toContain(
      '[BOT SPACE EVENT — untrusted content from a owner viewer of "Demo"]',
    )
  })

  it("serves the runtime and the wrapper page", async () => {
    const { content, h, origin } = await published()
    const runtime = await fetch(`${content}_dsh/space.js`)
    expect(runtime.headers.get("cache-control")).toBe("no-store")
    expect(await runtime.text()).toContain('{"viewer":"owner","revision":1,"writable":true}')
    const link = await h.spaces.manager.link(ID, {
      label: "x",
      days: 1,
      reason: null,
      issuedBy: "owner",
    })
    const wrapper = await fetch(`${origin}${wrapperPathOf(link.token)}`, {
      headers: { "accept-language": "ja,en" },
    })
    expect(wrapper.status).toBe(200)
    expect(wrapper.headers.get("content-security-policy")).toContain("script-src 'sha256-HASH'")
    const html = await wrapper.text()
    expect(html).toContain("Bot b1 が作ったページです")
    expect(html).toContain(`src="${contentPathOf(link.token)}"`)
    expect((await fetch(`${origin}/bot-spaces/v/${link.token}`)).status).toBe(404)
  })
})
