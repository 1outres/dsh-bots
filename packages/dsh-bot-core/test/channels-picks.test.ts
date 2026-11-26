import { describe, expect, it } from "vitest"
import { changeWith } from "../src/client/channel-form"
import type { BotChannel, BotChannelSettingsRequest } from "../src/contract"
import { checkChannelHooks } from "../src/host/channels/catalog"
import type { ChannelRecord } from "../src/host/channels/domain"
import { messageHeader } from "../src/host/channels/header"
import { createChannelPanel } from "../src/host/channels/panel"
import { createChannelSettings } from "../src/host/channels/settings"
import {
  type BotChannelField,
  type BotChannelView,
  checkChannelDescriptor,
  parseChannelChange,
  parseChannelSettingsRef,
} from "../src/shared/channels"
import { CAPABILITIES, memoryTable, memoryVault, SENDER, sharedChannels } from "./channels-support"

const PICK_FIELDS = [
  {
    kind: "secret",
    agent: { note: "Test secret." },
    key: "token",
    label: { en: "Token" },
    required: true,
    maxLength: 64,
  },
  {
    kind: "pick",
    agent: { note: "Test setting.", change: "free" },
    key: "home",
    label: { en: "Home" },
    required: true,
    source: "home",
    clears: ["owners"],
    maxLength: 16,
    pattern: "dm|[a-z]+",
  },
  {
    kind: "list",
    agent: { note: "Test setting.", change: "free" },
    key: "owners",
    label: { en: "Owners" },
    minItems: 1,
    maxItems: 2,
    item: { maxLength: 8, pattern: "[0-9]+", source: "people" },
  },
] as const satisfies readonly BotChannelField[]

type Asked = BotChannelSettingsRequest<Readonly<Record<string, string | readonly string[]>>>

function pickChannel(overrides: Partial<BotChannel> = {}) {
  const asked: { what: string; request: Asked }[] = []
  const channel: BotChannel = {
    id: "chat",
    name: "Chat",
    fields: PICK_FIELDS,
    owners: "owners",
    capabilities: CAPABILITIES,
    settingsVersion: 2,
    upgradeSettings: ({ values }) => ({
      values: { home: "dm", owners: Array.isArray(values.users) ? values.users.slice(0, 1) : [] },
      notes: ["kept one owner"],
    }),
    async options(request) {
      asked.push({ what: `options ${request.source}`, request })
      return { state: "ready", options: [{ value: "dm", label: { en: "DM" } }], suggested: ["dm"] }
    },
    async check(request) {
      asked.push({ what: "check", request })
      return (request.settings.owners as readonly string[]).length === 1
        ? { ok: true }
        : { ok: false, reason: { en: "one owner", ja: "1 人" } }
    },
    async inspect(request) {
      asked.push({ what: "inspect", request })
      return { state: "ready", account: "bot", links: [], warnings: [] }
    },
    connect: () => ({ async receive() {}, async close() {} }),
    ...overrides,
  }
  return { channel, asked }
}

function setup(channel: BotChannel) {
  const records = memoryTable<ChannelRecord>()
  const vault = memoryVault()
  const warnings: string[] = []
  const settings = createChannelSettings({
    records,
    vault,
    now: () => 9,
    warn: (message) => warnings.push(message),
  })
  const synced: number[] = []
  const panel = createChannelPanel({
    channels: () => [channel],
    channel: (id) => (id === channel.id ? channel : undefined),
    bot: (botId) => (botId === "a" ? { id: "a", name: "Alice" } : undefined),
    listed: () => true,
    settings,
    hub: { state: () => undefined, sync: () => synced.push(1) },
    profiles: { status: () => undefined },
    shared: sharedChannels(() => [channel]).panel,
    deadline: () => new AbortController().signal,
  })
  return { records, vault, settings, panel, warnings, synced }
}

const enabled = (values: Record<string, string | readonly string[]>, token = "t") => ({
  enabled: true,
  values,
  secrets: { token: { op: "set" as const, value: token } },
  profileSync: false,
})

describe("pick fields", () => {
  it("are checked in descriptors, parsed like text and count as missing while empty", () => {
    expect(() =>
      checkChannelDescriptor({ id: "chat", name: "Chat", fields: PICK_FIELDS }),
    ).not.toThrow()
    expect(() =>
      checkChannelDescriptor({
        id: "chat",
        name: "Chat",
        fields: [{ ...PICK_FIELDS[1], source: "Bad source!" }],
      }),
    ).toThrow("source")
    expect(() =>
      checkChannelDescriptor({
        id: "chat",
        name: "Chat",
        fields: [{ ...PICK_FIELDS[1], clears: ["nothing"] }],
      }),
    ).toThrow("clears")
    expect(parseChannelChange(PICK_FIELDS, enabled({ home: " dm ", owners: [] })).values.home).toBe(
      "dm",
    )
    expect(() => parseChannelChange(PICK_FIELDS, enabled({ home: "DM!", owners: [] }))).toThrow(
      "invalid format",
    )
  })

  it("need options for their sources and an upgrade above version 1", () => {
    const { channel } = pickChannel()
    expect(() => checkChannelHooks(channel)).not.toThrow()
    const { options: _options, ...withoutOptions } = channel
    expect(() => checkChannelHooks(withoutOptions as BotChannel)).toThrow("needs options")
    const { upgradeSettings: _upgrade, ...withoutUpgrade } = channel
    expect(() => checkChannelHooks(withoutUpgrade as BotChannel)).toThrow("upgradeSettings")
  })

  it("empty the fields they clear when the form changes them", () => {
    const view: BotChannelView = {
      channel: { id: "chat", name: "Chat", fields: PICK_FIELDS },
      enabled: true,
      values: { home: "dm", owners: ["1"] },
      secrets: { token: true },
      status: { state: "connecting" },
      revision: 3,
    }
    expect(changeWith(view, { kind: "value", key: "home", value: "general" }).values).toEqual({
      home: "general",
      owners: [],
    })
    expect(changeWith(view, { kind: "value", key: "home", value: "dm" }).values).toEqual({
      home: "dm",
      owners: ["1"],
    })
  })
})

describe("channel settings versions", () => {
  it("read older settings upgraded, store them again once, and warn what changed", async () => {
    const { channel } = pickChannel()
    const { records, settings, warnings } = setup(channel)
    await records.put("a:chat", {
      botId: "a",
      channelId: "chat",
      enabled: true,
      values: { users: ["7", "8"] },
      secrets: ["token"],
      updatedAt: 1,
    })
    expect(settings.view("a", channel).values).toEqual({ home: "dm", owners: ["7"] })
    await settings.upgrade(channel)
    expect(records.rows.get("a:chat")).toMatchObject({
      values: { home: "dm", owners: ["7"] },
      settingsVersion: 2,
      secrets: ["token"],
      enabled: true,
    })
    expect(warnings).toEqual([
      'bot-core: settings of channel "chat" of bot a upgraded to version 2: kept one owner',
    ])
    await settings.upgrade(channel)
    expect(warnings).toHaveLength(1)
  })

  it("leave settings of a newer version unread", async () => {
    const { channel } = pickChannel()
    const { records, settings } = setup(channel)
    await records.put("a:chat", {
      botId: "a",
      channelId: "chat",
      enabled: true,
      values: { home: "x" },
      secrets: [],
      settingsVersion: 3,
      updatedAt: 1,
    })
    expect(settings.view("a", channel)).toMatchObject({ enabled: false, values: { home: "" } })
    expect(settings.readiness("a", channel)).toEqual({ state: "off" })
  })
})

describe("the channel panel's questions", () => {
  it("refuses a save the channel's check refuses, and checks only enabled, complete settings", async () => {
    const { channel, asked } = pickChannel()
    const { panel, records, synced } = setup(channel)
    const refused = await panel.configure("a", "chat", enabled({ home: "dm", owners: ["1", "2"] }))
    expect(refused).toEqual({ saved: false, reason: { en: "one owner", ja: "1 人" } })
    expect(records.rows.size).toBe(0)
    expect(synced).toHaveLength(0)
    expect(asked[0]?.request).toMatchObject({
      bot: { id: "a", name: "Alice" },
      settings: { token: "t", home: "dm", owners: ["1", "2"] },
    })
    const incomplete = await panel.configure("a", "chat", enabled({ home: "", owners: [] }))
    expect(incomplete).toMatchObject({ saved: true })
    expect(asked).toHaveLength(1)
    const saved = await panel.configure("a", "chat", enabled({ home: "dm", owners: ["1"] }))
    expect(saved).toMatchObject({ saved: true, view: { values: { home: "dm" }, revision: 2 } })
    expect(JSON.stringify(saved)).not.toContain('"t"')
  })

  it("answers options and inspections for stored settings and for drafts, never for a source the channel lacks", async () => {
    const { channel, asked } = pickChannel()
    const { panel } = setup(channel)
    await panel.configure("a", "chat", enabled({ home: "dm", owners: ["1"] }, "stored"))
    await expect(
      panel.options("chat", { kind: "bot", botId: "a" }, "people", undefined),
    ).resolves.toMatchObject({ state: "ready" })
    expect(asked.at(-1)?.request.settings).toMatchObject({ token: "stored", home: "dm" })
    await panel.inspect(
      "chat",
      { kind: "draft", values: { home: "", owners: [] }, secrets: { token: "typed" } },
      undefined,
    )
    expect(asked.at(-1)).toMatchObject({
      what: "inspect",
      request: { settings: { token: "typed" } },
    })
    expect(asked.at(-1)?.request.bot).toBeUndefined()
    await expect(
      panel.options("chat", { kind: "bot", botId: "a" }, "elsewhere", undefined),
    ).rejects.toThrow("no source")
    await expect(
      panel.options("chat", { kind: "bot", botId: "zz" }, "home", undefined),
    ).rejects.toThrow("does not exist")
    await expect(
      panel.check(
        "chat",
        { kind: "draft", values: { home: "dm", owners: ["1", "2"] }, secrets: { token: "x" } },
        undefined,
      ),
    ).resolves.toEqual({ ok: false, reason: { en: "one owner", ja: "1 人" } })
  })

  it("parses a draft reference like a change", () => {
    expect(() =>
      parseChannelSettingsRef(PICK_FIELDS, undefined, {
        kind: "draft",
        values: { home: "dm", owners: [] },
        secrets: { nope: "x" },
      }),
    ).toThrow("not a secret")
    expect(() => parseChannelSettingsRef(PICK_FIELDS, undefined, { kind: "other" })).toThrow()
  })
})

describe("message headers", () => {
  it("name a server channel with its server, cleaned like names", () => {
    expect(
      messageHeader({
        channel: "Discord",
        place: { kind: "channel", channel: "gen(eral)", server: "Team · [x]" },
        sender: SENDER,
        owner: false,
      }),
    ).toBe("[Discord · #general (Team x) · Alice (@alice)]")
  })
})
