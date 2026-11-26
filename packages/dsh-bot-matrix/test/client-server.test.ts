import { describe, expect, it } from "vitest"
import { createMatrixApi, mediaPathOf } from "../src/host/client-server/api"
import type { FetchResponse, MatrixFetch } from "../src/host/client-server/http"
import { MatrixError } from "../src/host/matrix"
import { immediate } from "./support"

interface Seen {
  readonly url: URL
  readonly method: string
  readonly headers: Readonly<Record<string, string>>
  readonly body?: string | Uint8Array
}

function response(status: number, body: unknown): FetchResponse {
  const text = JSON.stringify(body)
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => "application/json" },
    json: async () => JSON.parse(text),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
    body: (async function* () {
      yield new TextEncoder().encode(text)
    })(),
  }
}

function fetcher(answers: readonly ((seen: Seen) => FetchResponse)[]) {
  const seen: Seen[] = []
  const fetch: MatrixFetch = async (url, init) => {
    const call: Seen = {
      url: new URL(url),
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
    }
    seen.push(call)
    const answer = answers[seen.length - 1] ?? answers.at(-1)
    if (answer === undefined) throw new Error("no answer")
    return answer(call)
  }
  return { fetch, seen }
}

const signal = new AbortController().signal

describe("Client-Server adapter", () => {
  it("sends every request of a bot with the AS token and identity assertion", async () => {
    const { fetch, seen } = fetcher([() => response(200, { event_id: "$e" })])
    const api = createMatrixApi(
      { fetch, scheduler: immediate, newId: () => "txn1" },
      "https://hs.example",
      "astoken",
    ).as("@dshbots_b1:example.org")
    expect(await api.send("!r:example.org", "m.room.message", { body: "x" }, signal)).toBe("$e")
    const [call] = seen
    expect(call?.method).toBe("PUT")
    expect(call?.url.pathname).toBe(
      "/_matrix/client/v3/rooms/!r%3Aexample.org/send/m.room.message/txn1",
    )
    expect(call?.url.searchParams.get("user_id")).toBe("@dshbots_b1:example.org")
    expect(call?.headers.authorization).toBe("Bearer astoken")
  })

  it("waits out 429 with retry_after_ms and sends the same request again", async () => {
    const { fetch, seen } = fetcher([
      () => response(429, { errcode: "M_LIMIT_EXCEEDED", retry_after_ms: 5 }),
      () => response(200, { joined_rooms: ["!a:x"] }),
    ])
    const api = createMatrixApi(
      { fetch, scheduler: immediate, newId: () => "t" },
      "https://hs.example",
      "tok",
    ).as("@u:x")
    expect(await api.joinedRooms(signal)).toEqual(["!a:x"])
    expect(seen).toHaveLength(2)
  })

  it("classifies refusals and treats a refused since as a bad position", async () => {
    const api = (status: number, errcode: string) =>
      createMatrixApi(
        {
          fetch: fetcher([() => response(status, { errcode })]).fetch,
          scheduler: immediate,
          newId: () => "t",
        },
        "https://hs",
        "tok",
      ).as("@u:x")
    await expect(api(401, "M_UNKNOWN_TOKEN").whoami(signal)).rejects.toMatchObject({
      kind: "token",
    })
    await expect(
      api(400, "M_UNKNOWN").sync({ since: "s", timeoutMs: 0, filter: {}, signal }),
    ).rejects.toMatchObject({ kind: "bad-since" })
    await expect(
      api(400, "M_UNKNOWN").sync({ timeoutMs: 0, filter: {}, signal }),
    ).rejects.toMatchObject({ kind: "rejected" })
    await expect(api(413, "M_TOO_LARGE").send("!r", "m", {}, signal)).rejects.toMatchObject({
      kind: "too-large",
    })
    expect(
      await createMatrixApi(
        {
          fetch: fetcher([() => response(400, { errcode: "M_USER_IN_USE" })]).fetch,
          scheduler: immediate,
          newId: () => "t",
        },
        "https://hs",
        "tok",
      ).register("dshbots_x", signal),
    ).toBe("exists")
  })

  it("normalizes a sync and skips events it cannot read", async () => {
    const { fetch, seen } = fetcher([
      () =>
        response(200, {
          next_batch: "n2",
          rooms: {
            join: {
              "!r:x": {
                timeline: {
                  events: [
                    {
                      event_id: "$1",
                      type: "m.room.message",
                      sender: "@a:x",
                      origin_server_ts: 3,
                      content: { body: "hi" },
                    },
                    { type: "broken" },
                  ],
                  limited: true,
                  prev_batch: "p",
                },
              },
            },
            invite: {
              "!i:x": {
                invite_state: {
                  events: [
                    {
                      type: "m.room.member",
                      sender: "@a:x",
                      state_key: "@b:x",
                      content: { membership: "invite", is_direct: true },
                    },
                  ],
                },
              },
            },
          },
        }),
    ])
    const sync = await createMatrixApi(
      { fetch, scheduler: immediate, newId: () => "t" },
      "https://hs",
      "tok",
    )
      .as("@b:x")
      .sync({ since: "n1", timeoutMs: 30000, filter: { a: 1 }, signal })
    expect(seen[0]?.url.searchParams.get("since")).toBe("n1")
    expect(sync.nextBatch).toBe("n2")
    expect(sync.joined.get("!r:x")).toMatchObject({
      limited: true,
      prevBatch: "p",
      timeline: [{ eventId: "$1", content: { body: "hi" } }],
    })
    expect(sync.invited.get("!i:x")).toMatchObject([
      { stateKey: "@b:x", content: { is_direct: true } },
    ])
  })

  it("refuses a download larger than allowed while it reads, through the authenticated media path", async () => {
    const big = new Uint8Array(10)
    const { fetch, seen } = fetcher([
      () => ({
        ...response(200, {}),
        body: (async function* () {
          yield big
        })(),
      }),
    ])
    const api = createMatrixApi(
      { fetch, scheduler: immediate, newId: () => "t" },
      "https://hs",
      "tok",
    ).as("@b:x")
    await expect(api.download("mxc://x/abc", 4, signal)).rejects.toBeInstanceOf(MatrixError)
    expect(seen[0]?.url.pathname).toBe("/_matrix/client/v1/media/download/x/abc")
    expect(() => mediaPathOf("https://x/abc")).toThrow("media address")
  })
})
