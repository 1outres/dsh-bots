import { describe, expect, it } from "vitest"
import { BOT_COMMANDS, checkChannelCapabilities } from "../src/host/channels/capabilities"
import { createCommandRunner } from "../src/host/channels/commands"
import { type ConversationDeps, openMainConversation } from "../src/host/channels/conversation"
import type { BotSessionRecord } from "../src/host/domain"
import { createInteractionBoard } from "../src/host/interactions/board"
import { createMaintenanceTurns } from "../src/host/mains/turns"
import {
  COMPACTION_ROW_ID,
  composeBotPreset,
  ENVIRONMENT_GROUP_ID,
} from "../src/host/preset/compose"
import { defaultTemplate } from "../src/host/preset/default-template"
import { type BotTable, createBotRegistry } from "../src/host/registry"
import { DEFAULT_BOT_MODELS } from "../src/shared/models"
import type { PluginRow } from "../src/shared/preset"
import { CAPABILITIES, inboundMessage, mainFeed } from "./channels-support"

describe("the /new command", () => {
  it("is for owners only and needs a channel that names its owners", () => {
    expect(BOT_COMMANDS.find((command) => command.id === "new")?.access).toBe("owners")
    const capabilities = { ...CAPABILITIES, commands: ["new"] as const }
    expect(() => checkChannelCapabilities({ id: "chat" }, capabilities)).toThrow(/owners field/)
    expect(() =>
      checkChannelCapabilities({ id: "chat", owners: "allowed" }, capabilities),
    ).not.toThrow()
  })

  it("runs only for an owner, and answers what the rotation came to", async () => {
    const ran: string[] = []
    const interactions = createInteractionBoard({
      newId: () => "q",
      publish: () => {},
      opened: () => {},
    })
    const outcomes = [
      { outcome: "started" as const, sessionId: "m2" },
      { outcome: "unchanged" as const },
      { outcome: "refused" as const, reason: "busy" as const, message: "busy" },
    ]
    const commands = createCommandRunner({
      mainSessionOf: () => "m1",
      agentOf: () => undefined,
      cancel: async () => {},
      startNew: async (botId) => {
        ran.push(botId)
        const next = outcomes.shift()
        if (next === undefined) throw new Error("no outcome")
        return next
      },
    })
    const deps: ConversationDeps = {
      mainSessionOf: () => "m1",
      activityOf: () => "idle",
      busyMode: () => "queue",
      compose: async () => ({ ok: true, content: [], images: 0, saved: [] }),
      prompt: async () => {},
      run: (botId, command) => commands.run(botId, command),
      interactions,
      admit: (_botId, work) => work("m1"),
      shield: async (_botId, _sessionId, message) => message,
    }
    const conversation = openMainConversation(
      deps,
      {
        botId: "a",
        channel: { id: "chat", name: "Chat" },
        capabilities: { ...CAPABILITIES, commands: ["stop", "status", "new"] },
        owners: new Set(["owner"]),
      },
      new AbortController().signal,
    )
    expect(await conversation.run("new", "stranger")).toEqual({
      ok: false,
      message: 'Only the bot\'s owners may use "new".',
    })
    expect(ran).toEqual([])
    expect(await conversation.run("new", "owner")).toEqual({
      ok: true,
      result: { command: "new", outcome: "started" },
    })
    expect(await conversation.run("new", "owner")).toEqual({
      ok: true,
      result: { command: "new", outcome: "unchanged" },
    })
    expect(await conversation.run("new", "owner")).toEqual({ ok: false, message: "busy" })
    expect(await conversation.run("stop", "stranger")).toMatchObject({ ok: true })
  })

  it("delivers a message to the Main the gate hands it, read after any rotation", async () => {
    const prompted: string[] = []
    const interactions = createInteractionBoard({
      newId: () => "q",
      publish: () => {},
      opened: () => {},
    })
    const conversation = openMainConversation(
      {
        mainSessionOf: () => "m1",
        activityOf: () => "idle",
        busyMode: () => "queue",
        compose: async () => ({ ok: true, content: [], images: 0, saved: [] }),
        async prompt(request) {
          prompted.push(request.sessionId)
        },
        run: async () => ({ ok: false, message: "-" }),
        interactions,
        admit: (_botId, work) => work("m2"),
        shield: async (_botId, _sessionId, message) => message,
      },
      {
        botId: "a",
        channel: { id: "chat", name: "Chat" },
        capabilities: CAPABILITIES,
        owners: new Set(),
      },
      new AbortController().signal,
    )
    expect(await conversation.deliver(inboundMessage("hi"))).toMatchObject({
      delivered: true,
      receipt: { sessionId: "m2" },
    })
    expect(prompted).toEqual(["m2"])
  })
})

describe("maintenance turns", () => {
  it("resolve at their end and keep every output of theirs off the channels", async () => {
    const turns = createMaintenanceTurns()
    const published: string[] = []
    const feed = mainFeed({
      botOfMainSession: () => "a",
      isSilent: () => false,
      isMaintenance: (sessionId, event) => turns.belongs(sessionId, event),
      publish: (_botId, output) => published.push(output.kind),
    })
    const event = (type: string, data: unknown) => {
      turns.follow("m1", { type, data })
      feed.sessionEvent("m1", { type, data })
    }
    const ended = turns.expect("m1")
    event("turn/start", { turn: 4 })
    event("assistant/message", {
      turn: 4,
      message: { id: "x", content: [{ type: "text", text: "notes written" }] },
    })
    event("turn/end", { turn: 4, reason: { kind: "completed" } })
    turns.idled("m1")
    expect(await ended).toEqual({ ended: "completed" })
    event("turn/start", { turn: 5 })
    expect(published).toEqual(["turn"])
    expect(turns.belongs("m1", { type: "turn/end", data: { turn: 4 } })).toBe(true)
  })

  it("resolve only once the Agent left the turn: idle, or in its next turn", async () => {
    const turns = createMaintenanceTurns()
    const settled: string[] = []
    const ended = turns.expect("m1").then((result) => settled.push(result.ended))
    turns.idled("m1")
    turns.follow("m1", { type: "turn/start", data: { turn: 2 } })
    turns.follow("m1", { type: "turn/end", data: { turn: 2, reason: { kind: "completed" } } })
    await Promise.resolve()
    expect(settled).toEqual([])
    turns.follow("m1", { type: "turn/start", data: { turn: 3 } })
    await ended
    expect(settled).toEqual(["completed"])

    const late = turns.expect("m1")
    turns.follow("m1", { type: "turn/start", data: { turn: 4 } })
    turns.idled("m1")
    turns.follow("m1", {
      type: "turn/end",
      data: { turn: 4, reason: { kind: "error", error: { message: "boom", code: "X" } } },
    })
    expect(await late).toMatchObject({ ended: "failed" })
  })

  it("refuse a second one while the first is still expected", () => {
    const turns = createMaintenanceTurns()
    void turns.expect("m1")
    expect(() => turns.expect("m1")).toThrow(/still running/)
  })

  it("fail when their prompt could not be queued", async () => {
    const turns = createMaintenanceTurns()
    const ended = turns.expect("m1")
    turns.abandon("m1", "not live")
    expect(await ended).toEqual({ ended: "failed", message: "not live" })
  })
})

const layer = { id: "vm", isolate: [], rows: [] }
const compose = (plugins: readonly PluginRow[]) =>
  composeBotPreset({
    botId: "b1",
    botName: "B",
    template: { ...defaultTemplate(), plugins: [...plugins] },
    overlay: [],
    allowedHostTools: new Set(),
    web: { backend: "exa", search: true, fetch: true },
    environment: layer,
    seal: (revision) => `sealed:${revision}`,
  })

function groupRows(plugins: readonly PluginRow[] | undefined): readonly PluginRow[] {
  const group = plugins?.find((row) => row.id === ENVIRONMENT_GROUP_ID)
  return (group?.config ?? []) as readonly PluginRow[]
}

describe("the compaction row", () => {
  it("sits in the template's group that isolates compaction", () => {
    const result = compose(defaultTemplate().plugins)
    if (!result.ok) throw new Error(result.problem)
    const rows = groupRows(result.preset.plugins)
    expect(rows.some((row) => row.id === COMPACTION_ROW_ID)).toBe(false)
    const compaction = rows.find((row) => row.id === "compaction")
    if (compaction === undefined) throw new Error("no compaction group")
    expect((compaction.config as readonly PluginRow[]).at(-1)).toEqual({
      id: COMPACTION_ROW_ID,
      name: "@1outres/dsh-bot-core/compaction",
      config: { botId: "b1", token: result.revisionToken },
    })
  })

  it("sits in the environment's group without such a group, and refuses two", () => {
    const plain = compose([{ id: "persona", name: "@deepseek-ai/dsh-persona" }])
    if (!plain.ok) throw new Error(plain.problem)
    expect(groupRows(plain.preset.plugins).some((row) => row.id === COMPACTION_ROW_ID)).toBe(true)
    const group = (id: string): PluginRow => ({
      id,
      name: "cordis:group",
      group: true,
      isolate: { compaction: true },
      config: [],
    })
    const twice = compose([group("one"), group("two")])
    expect(twice.ok ? "" : twice.problem).toMatch(/more than one group isolates "compaction"/)
  })
})

function memoryTable<V>(rows = new Map<string, V>()): BotTable<V> {
  return {
    get: (key) => rows.get(key),
    entries: () => rows.entries(),
    put: async (key, value) => {
      rows.set(key, value)
    },
    delete: async (key) => rows.delete(key),
  }
}

describe("replaceMain", () => {
  it("lists the former Main among the bot's other sessions, from when it was replaced", async () => {
    let clock = 1000
    let next = 0
    const sessions = new Map<string, BotSessionRecord>()
    const bots = createBotRegistry({
      table: memoryTable(),
      sessions: memoryTable(sessions),
      admit: () => {},
      connectors: { select: () => [], enable: async () => {} },
      specs: {
        initial: async () => ({ cpus: 2, memoryMiB: 2048, diskGiB: 10 }),
        create: async () => {},
        discard: async () => {},
      },
      models: {
        initial: async () => DEFAULT_BOT_MODELS,
        store: async () => {},
        discard: async () => {},
      },
      startMain: async (bot) => {
        const id = `s${++next}`
        await bots.adopt(bot.id, id)
        return id
      },
      openMain: () => {},
      renameMain: async () => {},
      canonicalTimezone: (value) => value as string,
      warn: () => {},
      newId: () => "b1",
      now: () => ++clock,
    })
    await bots.create({
      name: "B",
      avatar: { kind: "character", character: "capsule", color: "#6366F1" },
      language: "en",
      workstation: false,
      timezone: "Asia/Tokyo",
    })
    await bots.repairMains()
    await bots.adopt("b1", "s2")
    await bots.adopt("b1", "s3")
    await expect(bots.replaceMain("b1", "other", "s2", "owner")).rejects.toThrow(/no longer/)
    const view = await bots.replaceMain("b1", "s1", "s2", "daily")
    expect(view).toMatchObject({
      mainSessionId: "s2",
      sessionIds: ["s3", "s1"],
      formerMainIds: ["s1"],
    })
    expect(sessions.get("s1")?.retiredMain).toMatchObject({ reason: "daily" })
    expect(view.mainStartedAt).toBe(sessions.get("s2")?.createdAt)
    expect(bots.botOfMain("s1")).toBeUndefined()
    expect(bots.botOfSession("s1")).toBe("b1")
    await expect(bots.replaceMain("b1", "s2", "foreign", "owner")).rejects.toThrow(/not bot/)
  })
})
