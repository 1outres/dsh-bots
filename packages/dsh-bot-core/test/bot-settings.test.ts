import { Context, Service } from "@deepseek-ai/cordis"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { BotChannel } from "../src/channel-contract"
import type { SettingChangesClient } from "../src/client/setting-changes/client"
import { SettingChangesSection } from "../src/client/setting-changes/SettingChangesSection"
import { createInteractionBoard } from "../src/host/interactions/board"
import { createSettingsApprovals } from "../src/host/settings/approval"
import { channelAreas } from "../src/host/settings/areas/channels"
import { connectorAreas } from "../src/host/settings/areas/connectors"
import { createModelsArea, modelToken } from "../src/host/settings/areas/models"
import { createSettingsTurns, partyOf } from "../src/host/settings/authority"
import { createSettingsCatalog } from "../src/host/settings/catalog"
import { describeArea } from "../src/host/settings/describe"
import { createSettingsPanel } from "../src/host/settings/panel"
import { createSettingChangeStore } from "../src/host/settings/store"
import { createSettingsTool, parseSettingsArgs } from "../src/host/settings/tool"
import { CALL_SETTINGS_TOOL, SETTINGS_TOOL_AVAILABLE, type SettingsToolCall } from "../src/internal"
import BotSettingsTool from "../src/plugins/settings"
import type { BotSettingsArea } from "../src/settings-contract"
import {
  type BotChannelField,
  type BotChannelView,
  checkChannelDescriptor,
} from "../src/shared/channels"
import { connectorSettingsProblem } from "../src/shared/connectors"
import { DEFAULT_BOT_MODELS } from "../src/shared/models"
import {
  type BotSettingChange,
  type BotSettingChangeRecord,
  type BotSettingEntry,
  type BotSettingsHistoryView,
  changeRuleOf,
  settingAgentProblem,
  settingValue,
  settingValueProblem,
  shownSettingValue,
} from "../src/shared/settings"
import { bot, t, value } from "./support/client"
import { memoryTable } from "./support/skills-fs"

const STRICTNESS = {
  kind: "directional",
  strictness: { allow: 0, ask: 1, disallow: 2 },
  tighten: "free",
  loosen: "approve",
} as const

describe("setting values and rules", () => {
  it("decides a directional change by its direction", () => {
    expect(changeRuleOf(STRICTNESS, "allow", "ask")).toBe("free")
    expect(changeRuleOf(STRICTNESS, "disallow", "allow")).toBe("approve")
    expect(changeRuleOf(STRICTNESS, "allow", "unknown")).toBe("approve")
    expect(changeRuleOf("never", "a", "b")).toBe("never")
  })

  it("checks values against their shape", () => {
    expect(settingValueProblem({ kind: "toggle" }, "yes")).toBe("must be true or false")
    expect(settingValueProblem({ kind: "integer", min: 1, max: 3 }, 4)).toMatch("from 1 to 3")
    expect(settingValueProblem({ kind: "text", maxLength: 3, pattern: "[a-z]+" }, "ab1")).toBe(
      "has an invalid format",
    )
    const choice = {
      kind: "choice",
      choices: [{ value: "ja", label: { en: "Japanese" } }],
    } as const
    expect(settingValueProblem(choice, "en")).toMatch("must be one of")
    expect(
      settingValueProblem({ kind: "list", minItems: 1, maxItems: 2, item: choice }, ["ja", "ja"]),
    ).toBe("lists an item twice")
    expect(
      settingValueProblem({ kind: "list", minItems: 1, maxItems: 2, item: choice }, ["ja"]),
    ).toBeUndefined()
  })

  it("shows values by name", () => {
    const known = {
      kind: "text",
      maxLength: 20,
      known: [{ value: "1", label: { en: "Alice" } }],
    } as const
    expect(
      shownSettingValue({ kind: "list", minItems: 0, maxItems: 3, item: known }, ["1", "2"]),
    ).toEqual({
      en: "Alice, 2",
    })
    expect(shownSettingValue({ kind: "toggle" }, true)).toEqual({ en: "On", ja: "オン" })
  })

  it("requires the agent note of every channel and connector field", () => {
    expect(settingAgentProblem({ note: "x" }, true)).toBeUndefined()
    expect(settingAgentProblem({ note: "x", change: "free" }, true)).toMatch("secret")
    expect(settingAgentProblem({ note: "x" }, false)).toMatch("agent.change")
    const field = {
      kind: "text",
      key: "name",
      label: { en: "Name" },
      required: false,
      maxLength: 5,
    }
    expect(() =>
      checkChannelDescriptor({
        id: "chat",
        name: "Chat",
        fields: [field as unknown as BotChannelField],
      }),
    ).toThrow("agent is missing")
    expect(
      connectorSettingsProblem([
        { key: "big", kind: "toggle", label: { en: "Big" }, default: false },
      ]),
    ).toMatch("agent is missing")
  })
})

const event = (type: string, data: unknown) => ({ type, data })
const user = (text: string, extra: object = {}) =>
  event("user/message", { content: [{ type: "text", text }], source: { kind: "user", ...extra } })

describe("who started a turn", () => {
  it("knows the owner from the Web UI and the owner header, and others from notices", () => {
    expect(partyOf({ content: [{ type: "text", text: "hi" }], source: { kind: "user" } })).toBe(
      "owner",
    )
    expect(
      partyOf({
        content: [{ type: "text", text: "[Discord · DM · Bob (@bob)]\nhi" }],
        source: { kind: "user" },
      }),
    ).toBe("other")
    expect(partyOf({ content: [], source: { kind: "bot-schedule" } })).toBe("other")
    expect(partyOf({ content: [], source: { kind: "runtime-context" } })).toBeUndefined()
  })

  it("remembers who started the turn and whether someone else joined", () => {
    const turns = createSettingsTurns({ tracked: (id) => id === "s" })
    turns.sessionEvent("s", event("turn/start", { turn: 1 }))
    expect(turns.of("s")).toBeUndefined()
    turns.sessionEvent(
      "s",
      event("user/message", { content: [], source: { kind: "runtime-context" } }),
    )
    turns.sessionEvent("s", user("[Discord · DM · Alice (@alice, owner)]\nchange it"))
    expect(turns.of("s")).toEqual({ startedBy: "owner", mixed: false })
    turns.sessionEvent("s", user("[Discord · #g (T) · Bob (@bob)]\nme too"))
    expect(turns.of("s")).toEqual({ startedBy: "owner", mixed: true })
    turns.sessionEvent("s", event("turn/end", { turn: 1 }))
    expect(turns.of("s")).toBeUndefined()
    turns.sessionEvent("s", event("turn/start", { turn: 2 }))
    turns.sessionEvent(
      "s",
      event("user/message", { content: [], source: { kind: "bot-connector-event" } }),
    )
    expect(turns.of("s")?.startedBy).toBe("other")
  })
})

interface FakeArea extends BotSettingsArea {
  readonly applied: (readonly BotSettingChange[])[]
  values: Record<string, string | boolean>
}

function fakeArea(): FakeArea {
  const values: Record<string, string | boolean> = {
    name: "Aria",
    language: "en",
    avatar: "character",
  }
  const applied: (readonly BotSettingChange[])[] = []
  const area: FakeArea = {
    id: "general",
    label: { en: "General", ja: "一般" },
    location: { en: "Bot settings > General", ja: "ボットの設定 > 一般" },
    applied,
    values,
    async entries(): Promise<readonly BotSettingEntry[]> {
      const choice = {
        kind: "choice",
        choices: [
          { value: "en", label: { en: "English" } },
          { value: "ja", label: { en: "Japanese", ja: "日本語" } },
        ],
      } as const
      return [
        {
          key: "name",
          label: { en: "Name", ja: "名前" },
          agentNote: "Your name.",
          value: settingValue(undefined, area.values.name as string),
          accepts: { kind: "text", maxLength: 10 },
          change: "approve",
        },
        {
          key: "language",
          label: { en: "Language", ja: "言語" },
          agentNote: "Your language.",
          value: settingValue(choice, area.values.language as string),
          accepts: choice,
          change: "free",
        },
        {
          key: "avatar",
          label: { en: "Avatar", ja: "アバター" },
          agentNote: "Your picture.",
          value: settingValue(undefined, area.values.avatar as string),
          change: "never",
        },
      ]
    },
    implied: () => [],
    async apply(_botId, changes) {
      applied.push(changes)
      for (const change of changes) area.values[change.key] = change.value as string
      return { applied: true }
    },
  }
  return area
}

function setup(options: { language?: string } = {}) {
  const area = fakeArea()
  const catalog = createSettingsCatalog()
  catalog.register(area)
  const turns = createSettingsTurns({ tracked: () => true })
  const opened: { id: string; question: unknown; detail: unknown }[] = []
  const board = createInteractionBoard({
    newId: (() => {
      let next = 0
      return () => `i${++next}`
    })(),
    publish: () => {},
    opened: (_place, interaction) => {
      if (interaction.kind === "approval") {
        opened.push({
          id: interaction.id,
          question: interaction.question,
          detail: interaction.detail,
        })
      }
    },
  })
  const table = memoryTable<BotSettingChangeRecord>()
  const store = createSettingChangeStore({ settingChanges: table, kept: 3 })
  let clock = 1000
  let ids = 0
  const tool = createSettingsTool({
    sealed: (_botId, token) => token === "t",
    session: (_botId, agentId) =>
      agentId === "sched"
        ? { sessionId: agentId, kind: "schedule" }
        : { sessionId: agentId, kind: "main" },
    language: () => options.language,
    catalog,
    turns,
    approvals: createSettingsApprovals({
      board,
      channelName: (id) => (id === "discord" ? "Discord" : undefined),
    }),
    store,
    historyPlace: { en: "Bot settings > Changes by the bot" },
    deadline: () => new AbortController().signal,
    newId: () => `c${++ids}`,
    now: () => ++clock,
  })
  const startTurn = (by: string) => {
    turns.sessionEvent("main", event("turn/start", { turn: 1 }))
    turns.sessionEvent(
      "main",
      by === "owner" ? user("please") : user("[Discord · DM · Bob (@bob)]\nplease"),
    )
  }
  const call = (args: unknown, signal = new AbortController().signal) =>
    tool.call("b1", "t", { agentId: "main", args }, signal)
  return { area, catalog, board, store, table, tool, startTurn, call, opened, turns }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("bot_settings", () => {
  it("is offered to the Main and Web sessions only", () => {
    const { tool } = setup()
    expect(tool.available("b1", "t", "main")).toBe(true)
    expect(tool.available("b1", "t", "sched")).toBe(false)
    expect(tool.available("b1", "x", "main")).toBe(false)
  })

  it("describes the areas and one area in the bot's language", async () => {
    const { call } = setup({ language: "ja" })
    const summary = (await call({ action: "describe" })).text
    expect(summary).toContain('general — "一般" (Web UI: ボットの設定 > 一般)')
    expect(summary).toContain('  - language "言語": English ("en") [free]')
    const detail = (await call({ action: "describe", area: "general" })).text
    expect(detail).toContain('general / language — "言語" (Web UI: ボットの設定 > 一般 > 言語)')
    expect(detail).toContain("  For you: Your language.")
    expect(detail).toContain('Choices: "en" (English), "ja" (日本語).')
    expect(detail).toContain("Change: free (when your owner asks).")
    expect(detail).toContain("Change: you cannot change it")
  })

  it("parses its arguments strictly", () => {
    expect(() =>
      parseSettingsArgs({ action: "change", area: "general", changes: [], reason: "x" }),
    ).toThrow("at least one")
    expect(() =>
      parseSettingsArgs({ action: "change", area: "general", changes: [{ key: "a", value: 1 }] }),
    ).toThrow("reason")
    expect(() =>
      parseSettingsArgs({
        action: "change",
        area: "general",
        reason: "x",
        changes: [
          { key: "a", value: 1 },
          { key: "a", value: 2 },
        ],
      }),
    ).toThrow("twice")
  })

  it("changes only in a turn its owner started", async () => {
    const { call, startTurn, area } = setup()
    const change = {
      action: "change",
      area: "general",
      changes: [{ key: "language", value: "ja" }],
      reason: "asked",
    }
    await expect(call(change)).rejects.toThrow("turn bot-core saw start")
    startTurn("other")
    await expect(call(change)).rejects.toThrow("only when your owner asks")
    expect(area.applied).toEqual([])
  })

  it("applies a free change at once and records it", async () => {
    const { call, startTurn, area, store } = setup()
    startTurn("owner")
    const result = await call({
      action: "change",
      area: "general",
      changes: [{ key: "language", value: "ja" }],
      reason: "my owner asked",
    })
    expect(result.text).toContain("Changed general: Language: English → Japanese.")
    expect(area.applied).toEqual([[{ key: "language", value: "ja" }]])
    const [record] = store.list("b1")
    expect(record).toMatchObject({
      area: "general",
      reason: "my owner asked",
      sessionId: "main",
      items: [
        {
          key: "language",
          before: { raw: "en" },
          after: { raw: "ja", shown: { en: "Japanese", ja: "日本語" } },
        },
      ],
    })
    expect(record?.approvedBy).toBeUndefined()
  })

  it("refuses a setting it cannot change, a bad value and an unknown key", async () => {
    const { call, startTurn } = setup()
    startTurn("owner")
    const change = (key: string, value: unknown) =>
      call({ action: "change", area: "general", changes: [{ key, value }], reason: "r" })
    await expect(change("avatar", "image")).rejects.toThrow("Bot settings > General > Avatar")
    await expect(change("language", "fr")).rejects.toThrow("must be one of")
    await expect(change("color", "red")).rejects.toThrow('no setting "color"')
  })

  it("asks the owner for an approve setting, shows before and after, and records who approved", async () => {
    const { call, startTurn, area, board, opened, store } = setup()
    startTurn("owner")
    const pending = call({
      action: "change",
      area: "general",
      changes: [{ key: "name", value: "Bob" }],
      reason: "rename",
    })
    await settle()
    expect(opened).toHaveLength(1)
    expect(opened[0]?.question).toEqual({
      en: "Change your bot's settings: General?",
      ja: "ボットの設定「一般」を変更しますか？",
    })
    expect(opened[0]?.detail).toEqual({
      en: "- **Name**: Aria → Bob\n\nReason: rename",
      ja: "- **名前**: Aria → Bob\n\n理由: rename",
    })
    expect(area.applied).toEqual([])
    const answered = await board.answer(
      { kind: "main", botId: "b1" },
      opened[0]?.id ?? "",
      { kind: "approval", action: "allow-once" },
      { via: "channel", channelId: "discord" },
    )
    expect(answered).toEqual({ accepted: true })
    expect((await pending).text).toContain("Your owner approved it.")
    expect(store.list("b1")[0]?.approvedBy).toEqual({
      kind: "channel",
      channelId: "discord",
      channelName: "Discord",
    })
  })

  it("asks even for a free setting when someone else wrote in the turn", async () => {
    const { call, startTurn, turns, opened, board } = setup()
    startTurn("owner")
    turns.sessionEvent("main", user("[Discord · #g (T) · Bob (@bob)]\nhey"))
    const pending = call({
      action: "change",
      area: "general",
      changes: [{ key: "language", value: "ja" }],
      reason: "r",
    })
    await settle()
    expect(opened).toHaveLength(1)
    await board.answer(
      { kind: "session", sessionId: "main" },
      opened[0]?.id ?? "",
      { kind: "approval", action: "reject" },
      { via: "web" },
    )
    await expect(pending).rejects.toThrow("declined")
  })

  it("withdraws its approval when the call stops, and refuses a value that moved meanwhile", async () => {
    const { call, startTurn, opened, board, area } = setup()
    startTurn("owner")
    const controller = new AbortController()
    const stopped = call(
      { action: "change", area: "general", changes: [{ key: "name", value: "Bob" }], reason: "r" },
      controller.signal,
    )
    await settle()
    controller.abort()
    await expect(stopped).rejects.toThrow("withdrawn")
    expect(board.openIn("main")).toEqual([])
    const moved = call({
      action: "change",
      area: "general",
      changes: [{ key: "name", value: "Bob" }],
      reason: "r",
    })
    await settle()
    area.values.name = "Carl"
    await board.answer(
      { kind: "session", sessionId: "main" },
      opened[1]?.id ?? "",
      { kind: "approval", action: "allow-once" },
      { via: "web" },
    )
    await expect(moved).rejects.toThrow("changed meanwhile")
    expect(area.applied).toEqual([])
  })

  it("keeps the latest changes only", async () => {
    const { call, startTurn, store } = setup()
    startTurn("owner")
    for (const value of ["ja", "en", "ja", "en"]) {
      await call({
        action: "change",
        area: "general",
        changes: [{ key: "language", value }],
        reason: value,
      })
    }
    expect(store.list("b1").map((record) => record.reason)).toEqual(["en", "ja", "en"])
  })
})

describe("the change history in the Web UI", () => {
  const panelOf = (context: ReturnType<typeof setup>) =>
    createSettingsPanel({
      store: context.store,
      catalog: context.catalog,
      exists: () => true,
      deadline: () => new AbortController().signal,
      now: () => 5000,
      warn: () => {},
    })

  it("undoes a change through the area's own apply, once", async () => {
    const context = setup()
    context.startTurn("owner")
    await context.call({
      action: "change",
      area: "general",
      changes: [{ key: "language", value: "ja" }],
      reason: "r",
    })
    const panel = panelOf(context)
    const stop = panel.follow("b1")
    await settle()
    const [row] = panel.view("b1").rows
    expect(row?.revert).toEqual({ state: "available" })
    const result = await panel.revert("b1", row?.change.id ?? "")
    expect(result.reverted).toBe(true)
    expect(context.area.applied.at(-1)).toEqual([{ key: "language", value: "en" }])
    expect(panel.view("b1").rows[0]?.revert).toEqual({ state: "reverted", at: 5000 })
    expect(await panel.revert("b1", row?.change.id ?? "")).toMatchObject({ reverted: false })
    stop()
  })

  it("refuses to undo a change the setting moved on from", async () => {
    const context = setup()
    context.startTurn("owner")
    await context.call({
      action: "change",
      area: "general",
      changes: [{ key: "language", value: "ja" }],
      reason: "first",
    })
    await context.call({
      action: "change",
      area: "general",
      changes: [{ key: "language", value: "en" }],
      reason: "second",
    })
    const panel = panelOf(context)
    panel.follow("b1")
    await settle()
    const rows = panel.view("b1").rows
    expect(rows.map((row) => row.revert.state)).toEqual(["available", "superseded"])
    expect(await panel.revert("b1", rows[1]?.change.id ?? "")).toMatchObject({ reverted: false })
    context.area.values.language = "ja"
    expect(await panel.revert("b1", rows[0]?.change.id ?? "")).toMatchObject({ reverted: false })
  })
})

const discordFields = [
  {
    kind: "secret",
    key: "token",
    label: { en: "Token" },
    required: true,
    maxLength: 9,
    agent: { note: "Token." },
  },
  {
    kind: "pick",
    key: "home",
    label: { en: "Home" },
    required: true,
    source: "home",
    maxLength: 20,
    clears: ["owners"],
    agent: { note: "Home.", change: "approve" },
  },
  {
    kind: "list",
    key: "owners",
    label: { en: "Owners" },
    minItems: 1,
    maxItems: 3,
    item: { maxLength: 5, source: "owners" },
    agent: { note: "Owners.", change: "approve" },
  },
] as const satisfies readonly BotChannelField[]

describe("channel areas", () => {
  const channel = { id: "chat", name: "Chat", fields: discordFields } as unknown as BotChannel
  const viewOf = (values: BotChannelView["values"]): BotChannelView => ({
    channel: { id: "chat", name: "Chat", fields: discordFields },
    enabled: true,
    values,
    secrets: { token: true },
    status: { state: "waiting" },
    revision: 1,
  })

  it("names picked values, hides secrets and saves through the channel panel with clears", async () => {
    let view = viewOf({ home: "dm", owners: ["u1"] })
    const configured: unknown[] = []
    const [area] = channelAreas({
      channels: () => [channel],
      panel: {
        snapshot: () => ({ botId: "b1", channels: [view] }),
        async configure(_botId, _channelId, change) {
          configured.push(change)
          view = viewOf((change as { values: BotChannelView["values"] }).values)
          return { saved: true, view }
        },
        async options(_channelId, _settings, source) {
          return source === "home"
            ? {
                state: "ready",
                options: [{ value: "dm", label: { en: "Direct messages" } }],
                suggested: [],
              }
            : { state: "unavailable", reason: { en: "no token" } }
        },
      },
    })()
    if (area === undefined) throw new Error("no area")
    expect(area.id).toBe("channels.chat")
    const entries = await area.entries("b1", new AbortController().signal)
    expect(entries.map((entry) => [entry.key, entry.value.shown.en, entry.change])).toEqual([
      ["enabled", "On", "approve"],
      ["token", "Set (hidden)", "never"],
      ["home", "Direct messages", "approve"],
      ["owners", "u1", "approve"],
    ])
    await area.apply("b1", [{ key: "home", value: "1:2" }])
    expect(configured.at(-1)).toEqual({
      enabled: true,
      values: { home: "1:2", owners: [] },
      secrets: {},
      profileSync: false,
    })
    await area.apply("b1", [
      { key: "home", value: "dm" },
      { key: "owners", value: ["u2"] },
    ])
    expect(configured.at(-1)).toEqual({
      enabled: true,
      values: { home: "dm", owners: ["u2"] },
      secrets: {},
      profileSync: false,
    })
  })

  it("offers the profile sync of a channel that takes it, for the owner to approve", async () => {
    let view: BotChannelView = {
      ...viewOf({ home: "dm", owners: ["u1"] }),
      profile: { supports: { name: true, avatar: false }, sync: false },
    }
    const configured: unknown[] = []
    const [area] = channelAreas({
      channels: () => [channel],
      panel: {
        snapshot: () => ({ botId: "b1", channels: [view] }),
        async configure(_botId, _channelId, change) {
          configured.push(change)
          view = { ...view, profile: { supports: { name: true, avatar: false }, sync: true } }
          return { saved: true, view }
        },
        options: async () => ({ state: "unavailable", reason: { en: "no token" } }),
      },
    })()
    if (area === undefined) throw new Error("no area")
    const entries = await area.entries("b1", new AbortController().signal)
    expect(entries.map((entry) => [entry.key, entry.label.en, entry.change]).slice(0, 2)).toEqual([
      ["enabled", "On", "approve"],
      ["profileSync", "Sync the name to Chat", "approve"],
    ])
    expect(await area.apply("b1", [{ key: "profileSync", value: true }])).toEqual({
      applied: true,
    })
    expect(configured.at(-1)).toMatchObject({ enabled: true, profileSync: true })
  })
})

describe("connector areas", () => {
  it("lets the bot tighten a tool's permission freely and loosen it only with approval", async () => {
    const permissions: unknown[] = []
    const [area] = connectorAreas({
      connectors: () => [{ id: "mail", name: "Mail" }],
      panel: {
        views: () => [
          {
            connector: {
              id: "mail",
              name: "Mail",
              sessions: "main",
              settings: [],
              minimumSpec: {},
              requires: [],
              tools: [{ name: "send", toolName: "mail_send", description: "", permission: "ask" }],
            },
            enabled: true,
            values: {},
            readiness: { state: "disabled" },
            permissions: [{ connectorId: "mail", tool: "send", default: "ask", effective: "ask" }],
            status: {},
          },
        ],
        configure: async () => {
          throw new Error("not configured")
        },
        async setPermission(_botId, change) {
          permissions.push(change)
          return {} as never
        },
      },
    })()
    if (area === undefined) throw new Error("no area")
    const entries = await area.entries("b1", new AbortController().signal)
    const tool = entries.find((entry) => entry.key === "tool.send")
    if (tool === undefined) throw new Error("no tool entry")
    expect(tool.value.raw).toBe("default")
    expect(changeRuleOf(tool.change, "default", "disallow")).toBe("free")
    expect(changeRuleOf(tool.change, "default", "allow")).toBe("approve")
    expect(await area.apply("b1", [{ key: "tool.send", value: "disallow" }])).toEqual({
      applied: true,
    })
    expect(permissions).toEqual([{ connectorId: "mail", tool: "send", permission: "disallow" }])
  })
})

describe("the models area", () => {
  it("offers DSH's models as tokens and saves the choice they stand for", async () => {
    const saved: unknown[] = []
    const area = createModelsArea({
      view: () => ({ botId: "b1", models: DEFAULT_BOT_MODELS, mainPending: false }),
      configure: async (_botId, change) => {
        saved.push(change)
        return { botId: "b1", models: DEFAULT_BOT_MODELS, mainPending: false }
      },
      catalog: async () => ({
        profileDefault: { provider: "ds", model: "chat" },
        providers: [
          {
            id: "ds",
            name: "DeepSeek",
            models: [
              { id: "r1", name: "R1", reasoning: { efforts: [{ id: "high", name: "High" }] } },
            ],
          },
        ],
        failures: [],
      }),
    })
    const [main] = await area.entries("b1", new AbortController().signal)
    expect(main?.value).toEqual({
      raw: "profile-default",
      shown: { en: "DSH default (ds/chat)", ja: "DSH の既定（ds/chat）" },
    })
    expect(describeArea(area, [main as BotSettingEntry], undefined)).toContain(
      '"ds/r1@high" (DeepSeek · R1, reasoning effort High)',
    )
    await area.apply("b1", [{ key: "main", value: "ds/r1@high" }])
    expect(saved).toEqual([
      { main: { kind: "fixed", provider: "ds", model: "r1", reasoningEffort: "high" } },
    ])
    expect(modelToken({ kind: "fixed", provider: "ds", model: "r1" })).toBe("ds/r1")
    expect(await area.apply("b1", [{ key: "main", value: "x/y" }])).toMatchObject({
      applied: false,
    })
  })
})

describe("approvals of setting changes", () => {
  it("takes no answer from the Main session", async () => {
    const context = setup()
    context.startTurn("owner")
    const pending = context.call({
      action: "change",
      area: "general",
      changes: [{ key: "name", value: "Bob" }],
      reason: "r",
    })
    await settle()
    const id = context.opened[0]?.id ?? ""
    expect(
      await context.board.answer(
        { kind: "session", sessionId: "main" },
        id,
        { kind: "approval", action: "allow-once" },
        { via: "main" },
      ),
    ).toMatchObject({ accepted: false, reason: "invalid" })
    await context.board.answer(
      { kind: "session", sessionId: "main" },
      id,
      { kind: "approval", action: "allow-once" },
      { via: "web" },
    )
    expect((await pending).text).toContain("Your owner approved it.")
    expect(context.store.list("b1")[0]?.approvedBy).toEqual({ kind: "web" })
  })

  it("records what the area stored and shows what a change empties", async () => {
    const context = setup()
    const area = context.area
    Object.assign(area, {
      implied: (_botId: string, changes: readonly BotSettingChange[]) =>
        changes.some((change) => change.key === "language") ? [{ key: "name", value: "" }] : [],
      async apply(_botId: string, changes: readonly BotSettingChange[]) {
        area.applied.push(changes)
        area.values.language = "ja"
        area.values.name = ""
        return { applied: true }
      },
    })
    context.startTurn("owner")
    context.turns.sessionEvent("main", user("[Discord · #g (T) · Bob (@bob)]\nhey"))
    const pending = context.call({
      action: "change",
      area: "general",
      changes: [{ key: "language", value: "ja" }],
      reason: "r",
    })
    await settle()
    expect(context.opened[0]?.detail).toMatchObject({
      en: expect.stringContaining("- **Name**: Aria → (empty)"),
    })
    await context.board.answer(
      { kind: "session", sessionId: "main" },
      context.opened[0]?.id ?? "",
      { kind: "approval", action: "allow-once" },
      { via: "web" },
    )
    await pending
    expect(context.store.list("b1")[0]?.items.map((item) => [item.key, item.after.raw])).toEqual([
      ["name", ""],
      ["language", "ja"],
    ])
  })
})

describe("@1outres/dsh-bot-core/settings", () => {
  class FakeBot extends Service {
    readonly calls: string[] = []
    constructor(ctx: Context) {
      super(ctx, "bot")
    }
    [SETTINGS_TOOL_AVAILABLE](_botId: string, _token: string, agentId: string) {
      return agentId === "main"
    }
    async [CALL_SETTINGS_TOOL](botId: string, token: string, request: SettingsToolCall) {
      this.calls.push(`${botId} ${token} ${request.agentId} ${JSON.stringify(request.args)}`)
      return { text: "described" }
    }
  }
  interface Registered {
    readonly definition: { name: string; execute(args: unknown, exec: object): Promise<unknown> }
    readonly options: { when(context: { agent: { id: string } }): boolean }
  }
  class FakeTools extends Service {
    readonly registered: Registered[] = []
    constructor(ctx: Context) {
      super(ctx, "tools")
    }
    register(definition: Registered["definition"], options: Registered["options"]) {
      this.registered.push({ definition, options })
      return () => {}
    }
  }

  it("registers bot_settings for the Agents the bot service offers it to, with the revision's token", async () => {
    const root = new Context()
    await root.plugin(FakeBot)
    await root.plugin(FakeTools)
    await root.plugin(BotSettingsTool, { botId: "a", token: "t" })
    const tools = root.get("tools") as unknown as FakeTools
    const service = root.get("bot") as unknown as FakeBot
    const [tool] = tools.registered as [Registered]
    expect(tool.definition.name).toBe("bot_settings")
    expect(tool.options.when({ agent: { id: "main" } })).toBe(true)
    expect(tool.options.when({ agent: { id: "run" } })).toBe(false)
    expect(
      await tool.definition.execute(
        { action: "describe" },
        { agent: { id: "main" }, signal: new AbortController().signal },
      ),
    ).toEqual({ text: "described" })
    expect(service.calls).toEqual(['a t main {"action":"describe"}'])
    await expect(
      tool.definition.execute({ action: "describe" }, { signal: new AbortController().signal }),
    ).rejects.toThrow("requires the calling Agent")
  })
})

describe("the Changes by the bot section", () => {
  const frame = {
    t,
    bot: bot("a", "m-a"),
    page: { detail: null, open() {}, back() {} },
    close() {},
    confirm: async () => true,
  }
  const record = (id: string, revertedAt?: number): BotSettingChangeRecord => ({
    id,
    botId: "a",
    at: 1000,
    area: "general",
    areaLabel: { en: "General" },
    location: { en: "Bot settings > General" },
    items: [
      {
        key: "name",
        label: { en: "Name" },
        before: { raw: "Aria", shown: { en: "Aria" } },
        after: { raw: "Bob", shown: { en: "Bob" } },
      },
    ],
    reason: "asked",
    approvedBy: { kind: "channel", channelId: "discord", channelName: "Discord" },
    sessionId: "m-a",
    ...(revertedAt === undefined ? {} : { revertedAt }),
  })
  const client = (rows: BotSettingsHistoryView["rows"]): SettingChangesClient => ({
    bot: () => value({ status: "ready", value: { botId: "a", rows } }),
    revert: async () => ({ reverted: false, reason: { en: "no" } }),
  })

  it("lists the changes with Undo only where the values still hold", () => {
    const html = renderToStaticMarkup(
      createElement(SettingChangesSection, {
        ...frame,
        text: (text) => text.en,
        changes: client([
          { change: record("c2"), revert: { state: "available" } },
          { change: record("c1"), revert: { state: "superseded" } },
        ]),
      }),
    )
    expect(html).toContain("Aria → Bob")
    expect(html).toContain("settingChanges.approvedIn(Discord)")
    expect(html).toContain('data-dshb-setting-revert="c2"')
    expect(html).not.toContain('data-dshb-setting-revert="c1"')
    expect(html).toContain("settingChanges.superseded")
  })

  it("says when the bot changed nothing", () => {
    const html = renderToStaticMarkup(
      createElement(SettingChangesSection, {
        ...frame,
        text: (text) => text.en,
        changes: client([]),
      }),
    )
    expect(html).toContain("data-dshb-setting-changes-none")
  })
})
