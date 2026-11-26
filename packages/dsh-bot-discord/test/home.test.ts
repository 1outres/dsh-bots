import type { BotChannelConnectionState } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import {
  type DiscordChannelInfo,
  type DiscordGuildInfo,
  type DiscordLookup,
  DiscordLookupError,
  type DiscordMemberInfo,
  type DiscordUserInfo,
} from "../src/host/discord"
import type { DiscordSettings } from "../src/host/fields"
import { atHome, homeOf, homePlaceOf } from "../src/host/home"
import { createPresence, ownerNames } from "../src/host/people"
import { HOME_PERMISSIONS, has, PERMISSION, permissionsIn } from "../src/host/permissions"
import { createDiscordSettingsQueries, inviteUrl } from "../src/host/settings/queries"
import { upgradeDiscordSettings } from "../src/host/upgrade"
import { ALLOWED, CHANNEL_SETTINGS, DM_SETTINGS, GUILD, HOME_CHANNEL, OTHER } from "./support"

const APP = "700000000000000001"
const BOT = "800000000000000001"
const STRANGER = "900000000000000009"
const HIDDEN = "555555555555555555"

const user = (id: string, name: string, bot = false): DiscordUserInfo => ({
  id,
  username: name.toLowerCase(),
  displayName: name,
  avatarUrl: `https://cdn.discordapp.com/avatars/${id}/a.png`,
  bot,
})

const GUILD_INFO: DiscordGuildInfo = {
  id: GUILD,
  name: "Team",
  ownerId: "100000000000000000",
  roles: [
    {
      id: GUILD,
      permissions: PERMISSION.viewChannel | PERMISSION.sendMessages | PERMISSION.readMessageHistory,
    },
    { id: "600000000000000001", permissions: 0n },
  ],
}

const CHANNELS: readonly DiscordChannelInfo[] = [
  { id: HOME_CHANNEL, guildId: GUILD, name: "general", text: true, overwrites: [] },
  {
    id: HIDDEN,
    guildId: GUILD,
    name: "secret",
    text: true,
    overwrites: [
      { id: GUILD, kind: "role", allow: 0n, deny: PERMISSION.viewChannel },
      { id: ALLOWED, kind: "member", allow: PERMISSION.viewChannel, deny: 0n },
    ],
  },
  { id: "560000000000000000", guildId: GUILD, name: "voice", text: false, overwrites: [] },
]

const MEMBERS: readonly DiscordMemberInfo[] = [
  { user: user(OTHER, "Bob"), roles: [] },
  { user: user(ALLOWED, "Alice"), roles: [] },
  { user: user(BOT, "Helper", true), roles: [] },
]

function fakeLookup(
  overrides: Partial<DiscordLookup> = {},
  intents = { members: true, messageContent: true },
) {
  const asked: string[] = []
  const lookup: DiscordLookup = {
    async application() {
      asked.push("application")
      return { id: APP, bot: user(BOT, "Helper", true), owners: [user(ALLOWED, "Alice")], intents }
    },
    async guilds() {
      return [{ id: GUILD, name: "Team" }]
    },
    async guild(guildId) {
      return guildId === GUILD ? GUILD_INFO : undefined
    },
    async channels() {
      return CHANNELS
    },
    async member(_guildId, userId) {
      return MEMBERS.find((member) => member.user.id === userId)
    },
    async members() {
      asked.push("members")
      return MEMBERS
    },
    async user(userId) {
      return userId === STRANGER ? user(STRANGER, "Carol") : undefined
    },
    ...overrides,
  }
  return { lookup, asked }
}

const signal = new AbortController().signal

function queries(lookup: DiscordLookup) {
  const tokens: string[] = []
  return {
    tokens,
    queries: createDiscordSettingsQueries((token) => {
      tokens.push(token)
      return lookup
    }),
  }
}

describe("the home setting", () => {
  it("names direct messages or one server channel, and needs one owner in DMs", () => {
    expect(homePlaceOf("dm")).toEqual({ kind: "dm" })
    expect(homePlaceOf(`${GUILD}:${HOME_CHANNEL}`)).toEqual({
      kind: "channel",
      guildId: GUILD,
      channelId: HOME_CHANNEL,
    })
    expect(homePlaceOf("")).toBeUndefined()
    expect(homeOf(DM_SETTINGS)).toEqual({ kind: "dm", owner: ALLOWED })
    expect(() => homeOf({ ...DM_SETTINGS, approvers: [ALLOWED, OTHER] })).toThrow(
      "exactly one owner",
    )
  })

  it("is where the owner's DMs or the home channel are, nowhere else", () => {
    const dm = homeOf(DM_SETTINGS)
    expect(atHome(dm, { userId: ALLOWED, guildId: null, channelId: "dm" })).toBe(true)
    expect(atHome(dm, { userId: OTHER, guildId: null, channelId: "dm" })).toBe(false)
    const channel = homeOf(CHANNEL_SETTINGS)
    expect(atHome(channel, { userId: OTHER, guildId: GUILD, channelId: HOME_CHANNEL })).toBe(true)
    expect(atHome(channel, { userId: ALLOWED, guildId: null, channelId: HOME_CHANNEL })).toBe(false)
    expect(atHome(channel, { userId: ALLOWED, guildId: GUILD, channelId: HIDDEN })).toBe(false)
  })
})

describe("Discord settings version 1 to 2", () => {
  it("keeps the first owner who was also allowed, in direct messages, and notes who was dropped", () => {
    expect(
      upgradeDiscordSettings({
        version: 1,
        values: { users: [OTHER, ALLOWED], approvers: [STRANGER, ALLOWED], language: "ja" },
      }),
    ).toEqual({
      values: { home: "dm", approvers: [ALLOWED], language: "ja" },
      notes: [
        `the home is now direct messages with ${ALLOWED}; no longer allowed or owners: ${STRANGER}, ${OTHER}`,
      ],
    })
  })

  it("falls back on the first owner, then the first allowed user", () => {
    expect(
      upgradeDiscordSettings({ version: 1, values: { users: [OTHER], approvers: [STRANGER] } })
        .values,
    ).toMatchObject({ approvers: [STRANGER] })
    expect(
      upgradeDiscordSettings({ version: 1, values: { users: [OTHER], approvers: [] } }),
    ).toEqual({ values: { home: "dm", approvers: [OTHER] }, notes: [] })
    expect(upgradeDiscordSettings({ version: 1, values: {} }).values).toEqual({
      home: "dm",
      approvers: [],
    })
  })
})

describe("channel permissions", () => {
  it("apply @everyone, roles and member overwrites in Discord's order", () => {
    const [home, hidden] = CHANNELS as [DiscordChannelInfo, DiscordChannelInfo]
    const everyone = { userId: OTHER, roles: [] }
    expect(has(permissionsIn(GUILD_INFO, home, everyone), HOME_PERMISSIONS)).toBe(true)
    expect(has(permissionsIn(GUILD_INFO, hidden, everyone), PERMISSION.viewChannel)).toBe(false)
    expect(
      has(
        permissionsIn(GUILD_INFO, hidden, { userId: ALLOWED, roles: [] }),
        PERMISSION.viewChannel,
      ),
    ).toBe(true)
    expect(
      has(
        permissionsIn(GUILD_INFO, hidden, { userId: GUILD_INFO.ownerId, roles: [] }),
        PERMISSION.viewChannel,
      ),
    ).toBe(true)
  })
})

describe("Discord settings queries", () => {
  it("offer direct messages first and the text channels the bot can use, suggesting DMs", async () => {
    const { lookup } = fakeLookup()
    const { queries: answer, tokens } = queries(lookup)
    const options = await answer.options({ source: "home", settings: DM_SETTINGS, signal })
    expect(tokens).toEqual(["tok"])
    expect(options).toMatchObject({ state: "ready", suggested: ["dm"] })
    if (options.state !== "ready") throw new Error("unavailable")
    expect(options.options.map((option) => [option.value, option.label.en])).toEqual([
      ["dm", "Direct messages"],
      [`${GUILD}:${HOME_CHANNEL}`, "#general (Team)"],
    ])
  })

  it("say why there is nothing to pick without a token, a home or a token Discord takes", async () => {
    const { queries: answer } = queries(
      fakeLookup({
        async application() {
          throw new DiscordLookupError("token-rejected", "401")
        },
      }).lookup,
    )
    const empty: DiscordSettings = { ...DM_SETTINGS, token: "" }
    expect(await answer.options({ source: "home", settings: empty, signal })).toMatchObject({
      state: "unavailable",
      reason: { en: "Set the bot token first." },
    })
    expect(
      await answer.options({ source: "owners", settings: { ...DM_SETTINGS, home: "" }, signal }),
    ).toMatchObject({ state: "unavailable", reason: { en: "Choose the home first." } })
    expect(await answer.options({ source: "home", settings: DM_SETTINGS, signal })).toMatchObject({
      state: "unavailable",
      reason: { en: expect.stringContaining("rejected the bot token") },
    })
  })

  it("offer the application's owners in DMs, with a stored owner who is not one of them", async () => {
    const { queries: answer } = queries(fakeLookup().lookup)
    const options = await answer.options({
      source: "owners",
      settings: { ...DM_SETTINGS, approvers: [STRANGER] },
      signal,
    })
    if (options.state !== "ready") throw new Error("unavailable")
    expect(options.suggested).toEqual([ALLOWED])
    expect(
      options.options.map((option) => [option.value, option.label.en, option.detail?.en]),
    ).toEqual([
      [ALLOWED, "Alice", "@alice · Owner of the application"],
      [STRANGER, "Carol", "@carol"],
    ])
  })

  it("offer the people who can see the home channel, the application's owner first and no bots", async () => {
    const { lookup } = fakeLookup()
    const { queries: answer } = queries(lookup)
    const options = await answer.options({ source: "owners", settings: CHANNEL_SETTINGS, signal })
    if (options.state !== "ready") throw new Error("unavailable")
    expect(options.options.map((option) => option.value)).toEqual([ALLOWED, OTHER])
    expect(options.suggested).toEqual([ALLOWED])
    const hidden = await answer.options({
      source: "owners",
      settings: { ...CHANNEL_SETTINGS, home: `${GUILD}:${HIDDEN}` },
      signal,
    })
    expect(hidden).toMatchObject({ state: "unavailable" })
  })

  it("need the Server Members intent to list a channel's people", async () => {
    const { lookup, asked } = fakeLookup({}, { members: false, messageContent: true })
    const { queries: answer } = queries(lookup)
    expect(
      await answer.options({ source: "owners", settings: CHANNEL_SETTINGS, signal }),
    ).toMatchObject({
      state: "unavailable",
      reason: { en: expect.stringContaining("Server Members Intent") },
    })
    expect(asked).not.toContain("members")
  })

  it("check one owner in DMs, and owners who can see the home channel", async () => {
    const { queries: answer } = queries(fakeLookup().lookup)
    expect(await answer.check({ settings: DM_SETTINGS, signal })).toEqual({ ok: true })
    expect(
      await answer.check({ settings: { ...DM_SETTINGS, approvers: [ALLOWED, OTHER] }, signal }),
    ).toMatchObject({
      ok: false,
      reason: { en: expect.stringContaining("exactly one owner") },
    })
    expect(
      await answer.check({
        settings: { ...CHANNEL_SETTINGS, approvers: [ALLOWED, OTHER] },
        signal,
      }),
    ).toEqual({ ok: true })
    expect(
      await answer.check({ settings: { ...CHANNEL_SETTINGS, approvers: [STRANGER] }, signal }),
    ).toMatchObject({
      ok: false,
      reason: { en: "Carol (@carol) is not a member of the home channel's server." },
    })
    const secret = { ...CHANNEL_SETTINGS, home: `${GUILD}:${HIDDEN}`, approvers: [ALLOWED] }
    expect(await answer.check({ settings: secret, signal })).toMatchObject({
      ok: false,
      reason: { en: expect.stringContaining("cannot see the home channel") },
    })
  })

  it("inspect the account, link the invite and warn of privileged intents a channel home needs", async () => {
    const { queries: answer } = queries(
      fakeLookup({}, { members: false, messageContent: false }).lookup,
    )
    const dm = await answer.inspect({ settings: DM_SETTINGS, signal })
    expect(dm).toMatchObject({ state: "ready", account: "helper", warnings: [] })
    if (dm.state !== "ready") throw new Error("unavailable")
    expect(dm.links[0]?.url).toBe(inviteUrl(APP))
    expect(inviteUrl(APP)).toContain("scope=bot%20applications.commands")
    const channel = await answer.inspect({ settings: CHANNEL_SETTINGS, signal })
    if (channel.state !== "ready") throw new Error("unavailable")
    expect(channel.warnings.map((warning) => warning.en.split(" ")[0])).toEqual([
      "Message",
      "Server",
    ])
  })
})

describe("owners' names", () => {
  it("are read as server members in a channel home, and reported with the connected state", async () => {
    const { lookup } = fakeLookup()
    const home = homeOf(CHANNEL_SETTINGS)
    const people = await ownerNames(lookup, home, [ALLOWED, STRANGER], signal)
    expect(people).toEqual({ [ALLOWED]: { displayName: "Alice", handle: "alice" } })
    const reports: BotChannelConnectionState[] = []
    const presence = createPresence((state) => reports.push(state))
    presence.report({ state: "connected", account: "helper" })
    presence.named(people)
    presence.report({ state: "connecting" })
    presence.report({ state: "connected", account: "helper" })
    expect(reports).toEqual([
      { state: "connected", account: "helper" },
      { state: "connected", account: "helper", people },
      { state: "connecting" },
      { state: "connected", account: "helper", people },
    ])
  })
})
