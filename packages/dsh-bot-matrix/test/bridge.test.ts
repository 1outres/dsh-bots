import type {
  BotChannelConnectionState,
  BotChannelLink,
  BotInboundMessage,
} from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { createMatrixBridge } from "../src/host/bridge"
import type { MatrixSettings } from "../src/host/fields"
import type { MatrixEvent, MatrixSync } from "../src/host/matrix"
import { openAccountRecords } from "../src/host/records/accounts"
import { openCursorRecords } from "../src/host/records/cursors"
import { openHomeRecords } from "../src/host/records/homes"
import type { MatrixShared } from "../src/host/shared-fields"
import { event, fakeApi, immediate, memoryTables, settle } from "./support"

const SHARED: MatrixShared = {
  server: "synapse",
  homeserver: "https://hs.example",
  asToken: "tok",
  prefix: "dshbots",
  defaultOwner: "",
}

function harness(cursor?: {
  readonly since: string
  readonly roomId: string
  readonly lastEventId: string
}) {
  const batches: MatrixSync[] = []
  let release: () => void = () => {}
  const api = fakeApi({
    sync: async (request) => {
      const next = batches.shift()
      if (next !== undefined) return next
      await new Promise<void>((resolve) => {
        release = resolve
        request.signal.addEventListener("abort", () => resolve(), { once: true })
      })
      throw new Error("aborted")
    },
  })
  const delivered: BotInboundMessage[] = []
  const states: BotChannelConnectionState[] = []
  const answers: unknown[] = []
  const runs: string[] = []
  const controller = new AbortController()
  const link: BotChannelLink<MatrixSettings, MatrixShared> = {
    bot: { id: "b1", name: "Bot" },
    settings: { home: "dm", approvers: ["@alice:example.org"], language: "" },
    shared: SHARED,
    signal: controller.signal,
    commands: [{ id: "status", description: { en: "status" }, access: "anyone" }],
    deliver: async (message) => {
      delivered.push(message)
      return { delivered: true, receipt: { sessionId: "s", mode: "queue", images: 0, saved: [] } }
    },
    run: async (command) => {
      runs.push(command)
      return {
        ok: true,
        result: { command: "status", status: { activity: "idle", loaded: false, queued: 0 } },
      }
    },
    answer: async (_id, answer) => {
      answers.push(answer)
      return { accepted: true }
    },
    hold: async () => ({ accepted: true }),
    decide: async () => ({ accepted: false, reason: "not-found" }),
    pendingActions: () => ({ ok: true, actions: [] }),
    openActions: () => [],
    connectorAction: () => undefined,
    answerSender: async () => ({ accepted: false, reason: "closed" }),
    pendingSenderInquiries: () => ({ ok: true, inquiries: [] }),
    openSenderInquiries: () => [],
    senderInquiry: () => undefined,
    activity: () => "idle",
    report: (state) => void states.push(state),
    reportProfile: () => {},
  }
  const tables = memoryTables()
  if (cursor !== undefined) void tables.cursors.put("b1", { botId: "b1", ...cursor, updatedAt: 1 })
  const push = (...events: MatrixEvent[]) => {
    batches.push({
      nextBatch: `n${batches.length + 2}`,
      joined: new Map([["!dm:example.org", { timeline: events, limited: false, state: [] }]]),
      invited: new Map(),
      left: new Set(),
    })
    release()
  }
  if (cursor === undefined) {
    batches.push({ nextBatch: "n1", joined: new Map(), invited: new Map(), left: new Set() })
  } else {
    void tables.homes.put("b1", {
      botId: "b1",
      owner: "@alice:example.org",
      roomId: cursor.roomId,
      updatedAt: 1,
    })
  }
  const connection = createMatrixBridge({
    link,
    open: () => api,
    tables,
    accounts: openAccountRecords(tables, () => 1),
    homes: openHomeRecords(tables, () => 1),
    cursors: openCursorRecords(tables, () => 1),
    scheduler: immediate,
    warn: () => {},
  })
  return { api, connection, push, delivered, states, answers, runs, controller, tables }
}

const sends = (api: ReturnType<typeof fakeApi>) =>
  api.calls
    .filter((call) => call.method === "send")
    .map((call) => call.args[2] as Record<string, unknown>)

describe("Matrix bridge", () => {
  it("keeps the last delivered event across syncs without news, so a later gap is caught up", async () => {
    const h = harness({ since: "s0", roomId: "!dm:example.org", lastEventId: "$old" })
    await settle()
    h.push()
    await settle()
    expect(h.tables.cursors.get("b1")).toMatchObject({ since: "n2", lastEventId: "$old" })
    h.controller.abort()
  })

  it("makes the bot's DM with its owner, reports connected, and takes the owner's messages once", async () => {
    const h = harness()
    await settle()
    expect(h.api.calls.find((call) => call.method === "createRoom")?.args[0]).toMatchObject({
      isDirect: true,
      invite: ["@alice:example.org"],
    })
    expect(h.states.at(-1)).toMatchObject({
      state: "connected",
      account: "@dshbots_b1:example.org",
    })
    const hello = event({ eventId: "$hi", content: { msgtype: "m.text", body: "hello" } })
    h.push(hello, event({ eventId: "$x", sender: "@mallory:example.org" }), hello)
    await settle()
    expect(
      h.delivered.map((message) => [message.text, message.sender.handle, message.place.kind]),
    ).toEqual([["hello", "@alice:example.org", "direct"]])
    expect(
      sends(h.api).find(
        (content) => (content["m.relates_to"] as Record<string, unknown> | undefined)?.key === "👀",
      ),
    ).toBeDefined()
    expect(h.api.calls.some((call) => call.method === "receipt" && call.args[1] === "$hi")).toBe(
      true,
    )
    expect(h.tables.cursors.get("b1")).toMatchObject({ since: "n2", lastEventId: "$x" })
    h.controller.abort()
  })

  it("answers a command with a notice, and a question card with the owner's reaction", async () => {
    const h = harness()
    await settle()
    h.push(event({ eventId: "$c", content: { msgtype: "m.text", body: "!status" } }))
    await settle()
    expect(h.runs).toEqual(["status"])
    expect(sends(h.api).at(-1)).toMatchObject({ msgtype: "m.notice" })
    await h.connection.receive({
      kind: "interaction-opened",
      interaction: {
        id: "i1",
        kind: "question",
        questions: [
          {
            id: "q",
            question: "Pick",
            options: [{ label: "A" }, { label: "B" }],
            multiSelect: false,
          },
        ],
      },
    })
    await settle()
    const cardIndex = h.api.calls.findIndex(
      (call) =>
        call.method === "send" &&
        String((call.args[2] as Record<string, unknown>).body).includes("Pick"),
    )
    const cardId = `$sent${h.api.calls.slice(0, cardIndex + 1).filter((call) => call.method === "send").length}`
    h.push(
      event({
        eventId: "$r",
        type: "m.reaction",
        content: { "m.relates_to": { rel_type: "m.annotation", event_id: cardId, key: "2️⃣" } },
      }),
    )
    await settle()
    expect(h.answers).toEqual([{ kind: "question", answers: [{ id: "q", selected: ["B"] }] }])
    expect(h.delivered).toEqual([])
    h.controller.abort()
  })
})
