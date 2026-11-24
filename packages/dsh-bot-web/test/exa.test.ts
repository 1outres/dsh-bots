import { WebError } from "@deepseek-ai/dsh-web"
import { describe, expect, it } from "vitest"
import { createExaClient, type FetchFunction } from "../src/exa/client"
import { createExa } from "../src/exa/exa"
import { failureError, failureReason } from "../src/exa/failure"
import { mapFetch, mapSearch } from "../src/exa/map"
import { EXA_OPTIONS, type ExaOptions } from "../src/exa/options"
import { fetchRequest, searchRequest, searchResultCount, testRequest } from "../src/exa/request"

const OPTIONS: ExaOptions = { ...EXA_OPTIONS, baseURL: "https://exa.test" }
const call = () => ({ apiKey: "secret-key", signal: new AbortController().signal })

describe("requests", () => {
  it.each([
    [undefined, 10],
    [3, 3],
    [0, 1],
    [500, 100],
    [2.7, 2],
    [Number.NaN, 10],
  ])("asks for %s results as %s", (maxResults, count) => {
    expect(searchResultCount(maxResults)).toBe(count)
  })

  it("searches with the fixed options and no domain filter", () => {
    expect(searchRequest({ query: "dsh", maxResults: 5 }, OPTIONS)).toEqual({
      path: "/search",
      body: {
        query: "dsh",
        type: "auto",
        numResults: 5,
        contents: { highlights: { maxCharacters: 1000 } },
      },
    })
  })

  it("asks for one character more than a page keeps", () => {
    expect(fetchRequest({ url: "https://a.test/" }, OPTIONS)).toEqual({
      path: "/contents",
      body: { urls: ["https://a.test/"], text: { maxCharacters: 100001 } },
    })
  })

  it("tests with the cheapest search", () => {
    expect(testRequest()).toEqual({
      path: "/search",
      body: {
        query: "Exa",
        type: "auto",
        numResults: 1,
        contents: { highlights: { maxCharacters: 100 } },
      },
    })
  })
})

describe("mapSearch", () => {
  it("keeps one source per URL in Exa's order, highlights as snippet and summary", () => {
    const mapped = mapSearch(
      {
        results: [
          {
            url: "https://a.test/",
            title: " A ",
            highlights: ["one", "two"],
            publishedDate: "2026-01-01",
          },
          { url: "https://b.test/", highlights: [] },
          { url: "https://a.test/", title: "again" },
          { title: "no url" },
          "junk",
        ],
        notices: [{ message: "Be careful" }],
        warnings: [{ code: "W1", message: "slow" }],
      },
      OPTIONS,
    )
    expect(mapped.result).toEqual({
      content: "Notes from Exa:\n- Be careful",
      sources: [
        {
          url: "https://a.test/",
          title: "A",
          snippet: "one",
          summary: "one … two",
          publishedAt: "2026-01-01",
        },
        { url: "https://b.test/" },
      ],
      truncated: false,
    })
    expect(mapped.warnings).toEqual(["Exa warning W1: slow"])
  })

  it("reads the text in text mode", () => {
    const mapped = mapSearch(
      { results: [{ url: "https://a.test/", text: "body" }] },
      {
        ...OPTIONS,
        searchContents: "text",
      },
    )
    expect(mapped.result.sources).toEqual([{ url: "https://a.test/", summary: "body" }])
  })

  it.each([null, [], {}, { results: "x" }])("refuses %j as a provider error", (payload) => {
    expect(() => mapSearch(payload, OPTIONS)).toThrow(WebError)
  })
})

describe("mapFetch", () => {
  const url = "https://a.test/"

  it("returns the text, cut at the limit", () => {
    const options = { ...OPTIONS, fetchMaxCharacters: 4 }
    expect(
      mapFetch(
        { results: [{ url, text: "abcdef" }], statuses: [{ id: url, status: "success" }] },
        url,
        options,
      ),
    ).toEqual({
      url,
      statusCode: 200,
      body: { kind: "text", content: "abcd" },
      truncated: true,
    })
    expect(mapFetch({ results: [{ url, text: "abcd" }] }, url, options).truncated).toBe(false)
  })

  it("returns a failed crawl's HTTP status as the result", () => {
    expect(
      mapFetch(
        {
          results: [],
          statuses: [
            { id: url, status: "error", error: { tag: "CRAWL_NOT_FOUND", httpStatusCode: 404 } },
          ],
        },
        url,
        OPTIONS,
      ),
    ).toEqual({ url, statusCode: 404, body: { kind: "text", content: "" }, truncated: false })
  })

  it("refuses other failures and missing contents", () => {
    const failed = () =>
      mapFetch(
        { statuses: [{ id: url, status: "error", error: { tag: "CRAWL_TIMEOUT" } }] },
        url,
        OPTIONS,
      )
    expect(failed).toThrow("CRAWL_TIMEOUT")
    expect(() => mapFetch({ results: [] }, url, OPTIONS)).toThrow(WebError)
  })
})

describe("failures", () => {
  it.each([
    [401, "invalid-secret"],
    [403, "invalid-secret"],
    [402, "no-credits"],
    [429, "rate-limited"],
    [500, "unexpected"],
  ] as const)("HTTP %s is %s", (status, reason) => {
    expect(failureReason({ kind: "http", status })).toBe(reason)
    const error = failureError({ kind: "http", status })
    expect(error.code).toBe("WEB_PROVIDER_ERROR")
    expect(error.message).toContain(String(status))
  })

  it("words a cancellation as WEB_ABORTED, an unreachable API as unreachable", () => {
    expect(failureError({ kind: "aborted" }).code).toBe("WEB_ABORTED")
    expect(failureReason({ kind: "unreachable", message: "ECONNREFUSED" })).toBe("unreachable")
    expect(failureReason({ kind: "malformed", message: "x" })).toBe("unexpected")
  })
})

interface Sent {
  readonly url: string
  readonly init: RequestInit
}

function fakeFetch(respond: (sent: Sent) => Response | Promise<Response>) {
  const sent: Sent[] = []
  const fetch: FetchFunction = async (url, init) => {
    sent.push({ url, init })
    return respond({ url, init })
  }
  return { fetch, sent }
}

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })

describe("client", () => {
  it("POSTs JSON with the key and refuses redirects", async () => {
    const { fetch, sent } = fakeFetch(() => json(200, { results: [] }))
    const client = createExaClient({ baseURL: "https://exa.test/", fetch })
    expect(await client.send(testRequest(), call())).toEqual({ ok: true, payload: { results: [] } })
    expect(sent[0]?.url).toBe("https://exa.test/search")
    expect(sent[0]?.init).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { "x-api-key": "secret-key", "content-type": "application/json" },
    })
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual(testRequest().body)
  })

  it("classifies HTTP errors with Exa's detail, never the key", async () => {
    const { fetch } = fakeFetch(() => json(500, { error: "boom" }))
    const client = createExaClient({ baseURL: "https://exa.test", fetch })
    const response = await client.send(testRequest(), call())
    expect(response).toEqual({ ok: false, failure: { kind: "http", status: 500, detail: "boom" } })
  })

  it("tells unreachable, aborted, too large and malformed apart", async () => {
    const down = createExaClient({
      baseURL: "https://exa.test",
      fetch: fakeFetch(() => Promise.reject(new Error("ECONNREFUSED"))).fetch,
    })
    expect(await down.send(testRequest(), call())).toEqual({
      ok: false,
      failure: { kind: "unreachable", message: "ECONNREFUSED" },
    })
    const controller = new AbortController()
    controller.abort()
    expect(await down.send(testRequest(), { apiKey: "k", signal: controller.signal })).toEqual({
      ok: false,
      failure: { kind: "aborted" },
    })
    const big = createExaClient({
      baseURL: "https://exa.test",
      fetch: fakeFetch(() => new Response("x".repeat(64))).fetch,
      maxResponseBytes: 16,
    })
    expect(await big.send(testRequest(), call())).toEqual({
      ok: false,
      failure: { kind: "too-large", limit: 16 },
    })
    const text = createExaClient({
      baseURL: "https://exa.test",
      fetch: fakeFetch(() => new Response("<html>")).fetch,
    })
    expect(await text.send(testRequest(), call())).toEqual({
      ok: false,
      failure: { kind: "malformed", message: "not JSON" },
    })
  })
})

describe("createExa", () => {
  it("searches, logs Exa's warnings and throws its failures as WebError", async () => {
    const warnings: string[] = []
    let status = 200
    const { fetch } = fakeFetch(() =>
      json(status, {
        results: [{ url: "https://a.test/", title: "A" }],
        warnings: [{ message: "w" }],
      }),
    )
    const exa = createExa({ options: OPTIONS, fetch, warn: (message) => warnings.push(message) })
    expect(await exa.search({ query: "q" }, call())).toEqual({
      sources: [{ url: "https://a.test/", title: "A" }],
      truncated: false,
    })
    expect(warnings).toEqual(["Exa warning: w"])
    status = 402
    await expect(exa.search({ query: "q" }, call())).rejects.toMatchObject({
      code: "WEB_PROVIDER_ERROR",
    })
  })

  it("answers a test with ok or the reason", async () => {
    let response = () => json(200, { results: [] })
    const exa = createExa({
      options: OPTIONS,
      fetch: fakeFetch(() => response()).fetch,
      warn: () => {},
    })
    expect(await exa.test(call())).toEqual({ ok: true })
    response = () => json(401, {})
    expect(await exa.test(call())).toMatchObject({ ok: false, reason: "invalid-secret" })
    response = () => json(200, { nothing: true })
    expect(await exa.test(call())).toMatchObject({ ok: false, reason: "unexpected" })
    const results = [await exa.test(call())]
    expect(JSON.stringify(results)).not.toContain("secret-key")
  })
})
