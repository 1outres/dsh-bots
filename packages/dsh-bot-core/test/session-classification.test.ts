import { describe, expect, it } from "vitest"
import type { SessionListState, SessionSummary } from "../src/client/dsh/context"
import { type MainBinding, mainBindingOf, watchMainBinding } from "../src/client/main-session"
import {
  type BotsState,
  botSessionIds,
  classifySession,
  createSessionClassifier,
  type SessionClass,
  snapshotOf,
} from "../src/client/session-classification"
import type { BotsSnapshot } from "../src/shared/bots"
import { bot, creating, value } from "./support/client"

const x = bot("x", "m1", ["s1"])
const snapshot = (creatingSessionIds: string[] = []): BotsSnapshot => ({
  bots: [x],
  pending: [creating("c", creatingSessionIds)],
  preparingSessionIds: [],
})

const summary = (id: string, projectionValues?: SessionSummary["projectionValues"]) => ({
  id,
  displayTitle: id,
  running: false,
  blank: false,
  updatedAt: 0,
  ...(projectionValues === undefined ? {} : { projectionValues }),
})

const list = (phase: "pending" | "ready", summaries: SessionSummary[]): SessionListState => ({
  phase,
  ids: summaries.map((item) => item.id),
  byId: Object.fromEntries(summaries.map((item) => [item.id, item])),
})

const UNKNOWN: SessionClass = { kind: "unknown" }
const STOCK: SessionClass = { kind: "stock" }
const BY_PRESET = (botId: string): SessionClass => ({
  kind: "bot",
  botId,
  bot: undefined,
  source: "preset",
})

const WITHOUT_LIST: readonly BotsState[] = [
  { status: "loading" },
  { status: "unavailable" },
  { status: "unavailable", error: "watch: closed" },
  { status: "failed", error: "no typert" },
]

describe("classifySession", () => {
  describe.each([
    ["ready", (s: BotsSnapshot): BotsState => ({ status: "ready", snapshot: s })],
    ["reconnecting", (s: BotsSnapshot): BotsState => ({ status: "reconnecting", snapshot: s })],
  ])("with the bots list %s", (_status, state) => {
    const sessions = list("ready", [
      summary("m1", { agentPreset: null }),
      summary("w1", { agentPreset: "bot-x" }),
      summary("c1", { agentPreset: "bot-y" }),
    ])

    it.each([
      ["pending", list("pending", [])],
      ["ready", sessions],
    ])("lets the list decide whatever the session list (%s) says", (_phase, listed) => {
      expect(classifySession(state(snapshot()), listed, "m1")).toEqual({
        kind: "bot",
        botId: "x",
        bot: x,
        source: "bots",
      })
      expect(classifySession(state(snapshot()), listed, "s1")).toMatchObject({ botId: "x" })
    })

    it("corrects the preset's provisional errors: the legacy Main is a bot's, a Workspace session on a bot preset stock", () => {
      expect(classifySession(state(snapshot()), sessions, "m1")).toMatchObject({ kind: "bot" })
      expect(classifySession(state(snapshot()), sessions, "w1")).toEqual(STOCK)
    })

    it("counts a session of a bot being created as a bot's, without its bot yet", () => {
      expect(classifySession(state(snapshot()), sessions, "c1")).toEqual(STOCK)
      expect(classifySession(state(snapshot(["c1"])), sessions, "c1")).toEqual({
        kind: "bot",
        botId: undefined,
        bot: undefined,
        source: "bots",
      })
    })
  })

  describe.each(WITHOUT_LIST.map((state) => [state.status, state] as const))(
    "without a bots list (%s)",
    (_status, state) => {
      it("is unknown while the session list is pending", () => {
        expect(
          classifySession(state, list("pending", [summary("m1", { agentPreset: "bot-x" })]), "m1"),
        ).toEqual(UNKNOWN)
      })

      it.each([
        ["no summary", [], UNKNOWN],
        ["no projection values", [summary("a")], UNKNOWN],
        ["no agentPreset key", [summary("a", {})], UNKNOWN],
        ["the default preset (null)", [summary("a", { agentPreset: null })], STOCK],
        ["another preset", [summary("a", { agentPreset: "coder" })], STOCK],
        ["the bare prefix", [summary("a", { agentPreset: "bot-" })], STOCK],
        ["a bot's preset", [summary("a", { agentPreset: "bot-x" })], BY_PRESET("x")],
      ] as const)("reads the agent preset: %s", (_case, summaries, expected) => {
        expect(classifySession(state, list("ready", [...summaries]), "a")).toEqual(expected)
      })

      it("misreads provisionally: a legacy Main as stock, a Workspace session on a bot preset as a bot's", () => {
        const sessions = list("ready", [
          summary("m1", { agentPreset: null }),
          summary("w1", { agentPreset: "bot-x" }),
        ])
        expect(classifySession(state, sessions, "m1")).toEqual(STOCK)
        expect(classifySession(state, sessions, "w1")).toEqual(BY_PRESET("x"))
      })
    },
  )
})

describe("snapshotOf and botSessionIds", () => {
  it("hold a list only while ready or reconnecting", () => {
    const s = snapshot(["c1"])
    expect(snapshotOf({ status: "ready", snapshot: s })).toBe(s)
    expect(snapshotOf({ status: "reconnecting", snapshot: s })).toBe(s)
    for (const state of WITHOUT_LIST) expect(snapshotOf(state)).toBeUndefined()
    expect([...botSessionIds(s)].sort()).toEqual(["c1", "m1", "s1"])
  })
})

describe("mainBindingOf", () => {
  const ready = { phase: "ready" } as const
  const pending = { phase: "pending" } as const

  it("is settling without a session while either list DSH restores the selection from is pending", () => {
    expect(mainBindingOf(undefined, pending, pending)).toEqual({ kind: "settling" })
    expect(mainBindingOf(undefined, ready, pending)).toEqual({ kind: "settling" })
    expect(mainBindingOf(undefined, pending, ready)).toEqual({ kind: "settling" })
  })

  it("is none once both lists arrived, and the session whenever one is bound", () => {
    expect(mainBindingOf(undefined, ready, ready)).toEqual({ kind: "none" })
    expect(mainBindingOf("m1", pending, pending)).toEqual({ kind: "session", sessionId: "m1" })
  })

  it("follows uiSession's main binding and both lists", () => {
    const current = value<{ key?: unknown }>({})
    const sessions = value<{ phase: "pending" | "ready" }>(pending)
    const workspaces = value<{ phase: "pending" | "ready" }>(pending)
    const binding = watchMainBinding({ uiSession: { adapter: { current } }, sessions, workspaces })
    const seen: string[] = []
    binding.subscribe(() => seen.push(binding.getSnapshot().kind))
    sessions.set(ready)
    workspaces.set(ready)
    current.set({ key: "m1" })
    current.set({ key: "m1" })
    expect(seen).toEqual(["none", "session"])
  })
})

describe("createSessionClassifier", () => {
  const setup = () => {
    const main = value<MainBinding>({ kind: "settling" })
    const bots = value<BotsState>({ status: "loading" })
    const sessions = value(list("pending", []))
    return { main, bots, sessions, classifier: createSessionClassifier({ main, bots, sessions }) }
  }
  const session = (sessionId: string): MainBinding => ({ kind: "session", sessionId })

  it("is unknown while the main binding settles, stock without a session after it", () => {
    const { main, classifier } = setup()
    expect(classifier.main.getSnapshot()).toEqual(UNKNOWN)
    main.set({ kind: "none" })
    expect(classifier.main.getSnapshot()).toEqual(STOCK)
  })

  it("classifies the main view's session", () => {
    const { main, bots, sessions, classifier } = setup()
    const seen: SessionClass[] = []
    main.set({ kind: "none" })
    classifier.main.subscribe(() => seen.push(classifier.main.getSnapshot()))
    main.set(session("m1"))
    expect(classifier.main.getSnapshot()).toEqual(UNKNOWN)
    sessions.set(list("ready", [summary("m1", { agentPreset: null })]))
    expect(classifier.main.getSnapshot()).toEqual(STOCK)
    bots.set({ status: "ready", snapshot: snapshot() })
    expect(classifier.main.getSnapshot()).toMatchObject({ kind: "bot", bot: x, source: "bots" })
    expect(seen.map((item) => item.kind)).toEqual(["unknown", "stock", "bot"])
  })

  it("keeps the main class's reference while an update does not change it", () => {
    const { main, bots, classifier } = setup()
    const listed = snapshot()
    main.set(session("m1"))
    bots.set({ status: "ready", snapshot: listed })
    const first = classifier.main.getSnapshot()
    let calls = 0
    classifier.main.subscribe(() => {
      calls += 1
    })
    bots.set({ status: "reconnecting", snapshot: listed })
    expect(classifier.main.getSnapshot()).toBe(first)
    expect(calls).toBe(0)
  })

  it("classifies any session from the current sources", () => {
    const { bots, classifier } = setup()
    expect(classifier.classify("s1")).toEqual(UNKNOWN)
    bots.set({ status: "ready", snapshot: snapshot() })
    expect(classifier.classify("s1")).toMatchObject({ kind: "bot", botId: "x" })
    expect(classifier.classify("w1")).toEqual(STOCK)
  })
})
