import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import type { BotChannel, BotChannelCapabilities, BotChannelOutput } from "../src/contract"
import { createAccountReconciler } from "../src/host/channels/accounts"
import type { ConversationDeps } from "../src/host/channels/conversation"
import type { ChannelRecord } from "../src/host/channels/domain"
import { createChannelHub } from "../src/host/channels/hub"
import { createInitialChannels } from "../src/host/channels/initial"
import { createChannelOutlets } from "../src/host/channels/outlets"
import { createChannelPanel } from "../src/host/channels/panel"
import { createProfileRenderer } from "../src/host/channels/profile/render"
import { createProfileSync } from "../src/host/channels/profile/sync"
import { createChannelSettings } from "../src/host/channels/settings"
import { createConnectorApprovals } from "../src/host/connectors/approvals"
import { createInteractionBoard } from "../src/host/interactions/board"
import type { BotAvatar } from "../src/shared/avatar"
import type { ConnectorAction } from "../src/shared/connectors"
import type { VaultIncidentView } from "../src/shared/vaults"
import {
  CAPABILITIES,
  DECIDING,
  inboundMessage,
  memoryTable,
  memoryVault,
  recordingChannel,
  settle,
  sharedChannels,
} from "./channels-support"
import { brokerSetup } from "./connectors-support"

const pendingAction: ConnectorAction = {
  id: "act-1",
  botId: "a",
  connectorId: "mail",
  tool: "send",
  args: { to: "x@example.com", body: "hi" },
  preview: { title: "Send this email?", fields: [{ label: "To", value: "x@example.com" }] },
  sessionId: "main-a",
  createdAt: 1,
  expiresAt: 10_000_000,
  status: { state: "pending" },
}

const enable = {
  enabled: true,
  values: { server: "", users: ["1"] },
  secrets: { token: { op: "set", value: "tok-XYZ" } },
  profileSync: false,
}

const openIncident: VaultIncidentView = {
  id: "vinc-1",
  botId: "a",
  at: 1,
  source: "tool-result",
  tool: "bash",
  grantId: "cred-1",
  label: "Example login",
  kind: "password",
  outcome: "redacted",
}

function setup() {
  const records = memoryTable<ChannelRecord>()
  const vault = memoryVault()
  const settings = createChannelSettings({
    records,
    vault,
    now: () => 1,
    warn: (message) => warnings.push(message),
  })
  const bots: { id: string; name: string; avatar: BotAvatar }[] = [
    {
      id: "a",
      name: "Alice",
      avatar: { kind: "character", character: "capsule", color: "#6366F1" },
    },
  ]
  const stored = new Set(["a", "creating"])
  const channels: BotChannel[] = []
  const warnings: string[] = []
  const prompts: string[] = []
  const outlets = createChannelOutlets({ warn: (message) => warnings.push(message) })
  const interactions = createInteractionBoard({
    opened: () => {},
    newId: () => "q1",
    publish: (botId, output) => outlets.publish(botId, output),
  })
  const conversation: ConversationDeps = {
    admit: (botId, work) => work(botId === "a" ? "main-a" : undefined),
    shield: async (_botId, _sessionId, message) => message,
    mainSessionOf: (botId) => (botId === "a" ? "main-a" : undefined),
    activityOf: () => "idle",
    busyMode: () => "queue",
    async compose({ content, header }) {
      return {
        ok: true,
        content: [{ type: "text", text: `${header}\n${content.text}` }],
        images: 0,
        saved: [],
      }
    },
    async prompt(request) {
      const [part] = request.content
      prompts.push(part?.type === "text" ? part.text : "")
    },
    run: async () => ({ ok: false, message: "unused" }),
    interactions,
  }
  const connectors = brokerSetup({ actions: new Map([[pendingAction.id, pendingAction]]) })
  const approvals = createConnectorApprovals({
    ledger: connectors.ledger,
    broker: connectors.broker,
    catalog: connectors.catalog,
    exists: (botId) => stored.has(botId),
  })
  const drawn: string[] = []
  const profiles = createProfileSync({
    bot: (botId) => bots.find((bot) => bot.id === botId),
    enabled(botId, channelId) {
      const channel = channels.find((known) => known.id === channelId)
      return channel !== undefined && settings.view(botId, channel).profileSync
    },
    renderer: createProfileRenderer({
      rasterize: {
        async png(source) {
          drawn.push(source.kind)
          return new TextEncoder().encode(source.kind === "svg" ? source.svg : source.dataUrl)
        },
      },
      digest: (data) => createHash("sha256").update(data).digest("hex").slice(0, 12),
    }),
    publish: (botId, channelId, output) => outlets.publishTo(botId, channelId, output),
    warn: (message) => warnings.push(message),
  })
  settings.subscribe((botId) => profiles.refresh(botId))
  const shared = sharedChannels(() => channels, { synced: () => hub.sync() })
  const hub = createChannelHub({
    channels: () => channels,
    bots: () => bots,
    settings,
    shared: shared.settings,
    conversation,
    outlets,
    interactions,
    approvals,
    senders: {
      open: () => [],
      find: () => undefined,
      pendingFor: () => ({ ok: true, inquiries: [] }),
      fromChannel: async () => ({ accepted: false, reason: "not-found" }),
    },
    incidents: { open: (botId) => (botId === "a" ? [openIncident] : []) },
    profiles,
    warn: (message) => warnings.push(message),
  })
  settings.subscribe(() => hub.sync())
  const panel = createChannelPanel({
    channels: () => channels,
    channel: (id) => channels.find((channel) => channel.id === id),
    bot: (botId) => (stored.has(botId) ? { id: botId, name: botId } : undefined),
    listed: (botId) => bots.some((bot) => bot.id === botId),
    settings,
    hub,
    profiles,
    shared: shared.panel,
    deadline: () => new AbortController().signal,
  })
  return {
    shared,
    profiles,
    drawn,
    settings,
    hub,
    panel,
    channels,
    bots,
    warnings,
    prompts,
    outlets,
    interactions,
    ledger: connectors.ledger,
  }
}

describe("channel hub", () => {
  it("sends a deciding channel the open connector actions first, and takes decisions only from its approvers", async () => {
    const { panel, channels, ledger } = setup()
    const chat = recordingChannel("chat", DECIDING)
    channels.push(chat.channel)
    await panel.configure("a", "chat", enable)
    await settle()
    expect(chat.outputs).toMatchObject([
      { kind: "connector-action", action: { id: "act-1", status: { state: "pending" } } },
    ])
    const link = chat.links[0]
    expect(await link?.decide("act-1", "approve", "2")).toEqual({
      accepted: false,
      reason: "not-approver",
    })
    expect(ledger.get("act-1")?.status.state).toBe("pending")
    const accepted = await link?.decide("act-1", "approve", "1")
    expect(accepted).toMatchObject({ accepted: true, action: { status: { state: "approved" } } })
    expect(ledger.get("act-1")?.status).toMatchObject({
      decision: {
        decision: "approve",
        origin: { kind: "channel", channelId: "chat", channelName: "Chat", person: "1" },
      },
    })
    expect(await link?.decide("act-1", "reject", "1")).toMatchObject({
      accepted: false,
      reason: "settled",
      action: { status: { state: "approved" } },
    })
    await panel.configure("a", "chat", { ...enable, enabled: false, secrets: {} })
    await settle()
    expect(await link?.decide("act-1", "reject", "1")).toEqual({
      accepted: false,
      reason: "closed",
    })
  })

  it("lists the pending connector actions for an approver only, and reads one action as it stands", async () => {
    const { panel, channels } = setup()
    const chat = recordingChannel("chat", DECIDING)
    channels.push(chat.channel)
    await panel.configure("a", "chat", enable)
    await settle()
    const link = chat.links[0]
    expect(link?.pendingActions("2")).toEqual({ ok: false, reason: "not-approver" })
    expect(link?.pendingActions("1")).toMatchObject({
      ok: true,
      actions: [{ id: "act-1", status: { state: "pending" } }],
    })
    await link?.decide("act-1", "approve", "1")
    expect(link?.pendingActions("1")).toEqual({ ok: true, actions: [] })
    expect(link?.connectorAction("act-1")).toMatchObject({
      id: "act-1",
      status: { state: "approved" },
    })
    expect(link?.connectorAction("act-404")).toBeUndefined()
    await panel.configure("a", "chat", { ...enable, enabled: false, secrets: {} })
    await settle()
    expect(link?.pendingActions("1")).toEqual({ ok: false, reason: "closed" })
  })

  it("sends a channel telling owners of incidents the unacknowledged ones when it connects", async () => {
    const { panel, channels } = setup()
    const told = recordingChannel("told", { ...DECIDING, credentialIncidents: true })
    const silent = recordingChannel("silent", DECIDING)
    channels.push(told.channel, silent.channel)
    await panel.configure("a", "told", enable)
    await panel.configure("a", "silent", enable)
    await settle()
    expect(told.outputs.filter((output) => output.kind === "credential-incident")).toEqual([
      { kind: "credential-incident", incident: openIncident },
    ])
    expect(silent.outputs.some((output) => output.kind === "credential-incident")).toBe(false)
  })

  it("lets nobody decide through a channel without the capability, and sends it no action", async () => {
    const { panel, channels, ledger } = setup()
    const chat = recordingChannel()
    channels.push(chat.channel)
    await panel.configure("a", "chat", enable)
    await settle()
    expect(chat.outputs).toEqual([])
    expect(await chat.links[0]?.decide("act-1", "approve", "1")).toEqual({
      accepted: false,
      reason: "not-approver",
    })
    expect(chat.links[0]?.pendingActions("1")).toEqual({ ok: false, reason: "not-approver" })
    expect(chat.links[0]?.connectorAction("act-1")).toBeUndefined()
    expect(ledger.get("act-1")?.status.state).toBe("pending")
  })

  it("marks the sender an owner only when the channel's owners field lists them", async () => {
    const { panel, channels, prompts } = setup()
    const chat = recordingChannel("chat", CAPABILITIES, "users")
    channels.push(chat.channel)
    await panel.configure("a", "chat", { ...enable, values: { server: "", users: ["1", "2"] } })
    await settle()
    const link = chat.links[0]
    await link?.deliver(inboundMessage("mine"))
    await link?.deliver(
      inboundMessage("theirs", {
        sender: { id: "3", displayName: "Eve", handle: "eve", bot: true },
      }),
    )
    expect(prompts).toEqual([
      "[Chat · DM · Alice (@alice, owner)]\nmine",
      "[Chat · DM · Eve (@eve, bot)]\ntheirs",
    ])
  })

  it("counts nobody as an owner on a channel that names no owners field", async () => {
    const { panel, channels, prompts } = setup()
    const chat = recordingChannel()
    channels.push(chat.channel)
    await panel.configure("a", "chat", enable)
    await settle()
    await chat.links[0]?.deliver(inboundMessage("hi"))
    expect(prompts).toEqual(["[Chat · DM · Alice (@alice)]\nhi"])
  })

  it("connects an enabled, complete bot with its settings and closes it when disabled", async () => {
    const { hub, panel, channels, prompts } = setup()
    const chat = recordingChannel()
    channels.push(chat.channel)
    hub.sync()
    expect(chat.links).toEqual([])
    await panel.configure("a", "chat", enable)
    await settle()
    expect(chat.links).toHaveLength(1)
    const link = chat.links[0]
    expect(link?.bot).toEqual({ id: "a", name: "Alice" })
    expect(link?.settings).toEqual({ token: "tok-XYZ", server: "", users: ["1"] })
    expect(link?.commands.map((command) => command.id)).toEqual(["status", "stop"])
    await link?.deliver(inboundMessage("hello"))
    expect(prompts).toEqual(["[Chat · DM · Alice (@alice)]\nhello"])

    await panel.configure("a", "chat", { ...enable, enabled: false, secrets: {} })
    await settle()
    expect(chat.closed).toEqual([link])
    expect(link?.signal.aborted).toBe(true)
  })

  it("sends a connection the bot's outputs until it closes, and what was open before it connected", async () => {
    const { panel, channels, outlets, interactions } = setup()
    const chat = recordingChannel()
    channels.push(chat.channel)
    const question = { id: "q1", kind: "question", questions: [] } as const
    interactions.open({ botId: "a", sessionId: "main-a", main: true }, () => question, {
      answer: async () => ({ accepted: true }),
    })
    await panel.configure("a", "chat", enable)
    await settle()
    outlets.publish("a", { kind: "turn", turn: { phase: "started" } })
    outlets.publish("b", { kind: "turn", turn: { phase: "completed" } })
    await settle()
    expect(chat.outputs).toEqual([
      { kind: "interaction-opened", interaction: question },
      { kind: "turn", turn: { phase: "started" } },
    ])
    await panel.configure("a", "chat", { ...enable, enabled: false, secrets: {} })
    outlets.publish("a", { kind: "turn", turn: { phase: "completed" } })
    await settle()
    expect(chat.outputs).toHaveLength(2)
  })

  it("connects again after a settings change, once the previous connection closed", async () => {
    const { panel, channels } = setup()
    const chat = recordingChannel()
    channels.push(chat.channel)
    await panel.configure("a", "chat", enable)
    await settle()
    await panel.configure("a", "chat", { ...enable, values: { server: "x", users: ["2"] } })
    await settle()
    expect(chat.closed).toEqual([chat.links[0]])
    expect(chat.links).toHaveLength(2)
    expect(chat.links[1]?.settings).toMatchObject({ server: "x", users: ["2"] })
  })

  it("shows what a channel reports, and ignores reports after closing", async () => {
    const { panel, channels } = setup()
    const chat = recordingChannel()
    channels.push(chat.channel)
    await panel.configure("a", "chat", enable)
    await settle()
    const status = () => panel.snapshot("a").channels[0]?.status
    expect(status()).toEqual({ state: "connecting" })
    chat.links[0]?.report({ state: "connected", account: "alice-bot" })
    expect(status()).toEqual({ state: "connected", account: "alice-bot" })
    await panel.configure("a", "chat", { ...enable, enabled: false, secrets: {} })
    chat.links[0]?.report({ state: "failed", message: "late" })
    expect(status()).toEqual({ state: "off" })
  })

  it("shows a connect that throws as failed", async () => {
    const { panel, channels, warnings } = setup()
    const broken: BotChannel = {
      ...recordingChannel("broken").channel,
      connect() {
        throw new Error("boom")
      },
    }
    channels.push(broken)
    await panel.configure("a", "broken", enable)
    await settle()
    expect(panel.snapshot("a").channels[0]?.status).toEqual({ state: "failed", message: "boom" })
    expect(warnings[0]).toContain("boom")
  })

  it("closes the connections of a bot no longer listed and of an unregistered channel", async () => {
    const { hub, panel, channels, bots } = setup()
    const chat = recordingChannel()
    channels.push(chat.channel)
    await panel.configure("a", "chat", enable)
    await settle()
    bots.length = 0
    hub.sync()
    await settle()
    expect(chat.closed).toHaveLength(1)
    bots.push({
      id: "a",
      name: "Alice",
      avatar: { kind: "character", character: "capsule", color: "#6366F1" },
    })
    hub.sync()
    await settle()
    expect(chat.links).toHaveLength(2)
    channels.length = 0
    hub.sync()
    await settle()
    expect(chat.closed).toHaveLength(2)
  })

  it("closes everything on dispose", async () => {
    const { hub, panel, channels } = setup()
    const chat = recordingChannel()
    channels.push(chat.channel)
    await panel.configure("a", "chat", enable)
    await settle()
    await hub.dispose()
    expect(chat.closed).toHaveLength(1)
  })
})

describe("channel panel", () => {
  it("lists every registered channel with its settings and status, never a secret", async () => {
    const { panel, channels } = setup()
    channels.push(recordingChannel().channel)
    expect(panel.snapshot("a").channels[0]).toMatchObject({
      channel: { id: "chat", name: "Chat" },
      enabled: false,
      secrets: { token: false },
      status: { state: "off" },
    })
    const result = await panel.configure("a", "chat", {
      ...enable,
      values: { server: "", users: [] },
    })
    if (!result.saved) throw new Error("not saved")
    const { view } = result
    expect(view.status).toEqual({ state: "incomplete", missing: ["users"] })
    expect(JSON.stringify(view)).not.toContain("tok-XYZ")
    expect(Object.keys(view.channel)).toEqual(["id", "name", "fields"])
  })

  it("waits for a bot that is still being created", async () => {
    const { panel, channels } = setup()
    channels.push(recordingChannel().channel)
    const result = await panel.configure("creating", "chat", enable)
    expect(result).toMatchObject({ saved: true, view: { status: { state: "waiting" } } })
  })

  it("refuses unknown bots, unknown channels and invalid changes", async () => {
    const { panel, channels } = setup()
    channels.push(recordingChannel().channel)
    expect(() => panel.snapshot("nobody")).toThrow("does not exist")
    await expect(panel.configure("a", "other", enable)).rejects.toThrow("not registered")
    await expect(
      panel.configure("a", "chat", { ...enable, values: { server: "", users: ["x"] } }),
    ).rejects.toThrow("not a valid item")
  })
})

const PROFILED: BotChannelCapabilities = { ...CAPABILITIES, profile: { name: true, avatar: true } }

type ProfileOutput = Extract<BotChannelOutput, { kind: "profile" }>

describe("channel profiles", () => {
  const connected = async (capabilities = PROFILED) => {
    const context = setup()
    const chat = recordingChannel("chat", capabilities)
    context.channels.push(chat.channel)
    await context.panel.configure("a", "chat", enable)
    await settle()
    return { ...context, chat }
  }
  const profilesOf = (outputs: readonly BotChannelOutput[]) =>
    outputs.filter((output): output is ProfileOutput => output.kind === "profile")

  it("are off by default and push the name and avatar when turned on, without reconnecting", async () => {
    const { panel, chat, drawn } = await connected()
    expect(profilesOf(chat.outputs)).toEqual([])
    expect(panel.snapshot("a").channels[0]?.profile).toEqual({
      supports: { name: true, avatar: true },
      sync: false,
    })
    const result = await panel.configure("a", "chat", { ...enable, secrets: {}, profileSync: true })
    await settle()
    expect(result).toMatchObject({ saved: true, view: { revision: 1 } })
    expect(chat.links).toHaveLength(1)
    expect(chat.closed).toHaveLength(0)
    expect(drawn).toEqual(["svg"])
    expect(profilesOf(chat.outputs)).toMatchObject([
      {
        kind: "profile",
        profile: { name: "Alice", avatar: { mediaType: "image/png", size: 512 } },
      },
    ])
    expect(panel.snapshot("a").channels[0]?.profile?.status).toEqual({ state: "syncing" })
  })

  it("show what the channel reports for the latest profile only", async () => {
    const { panel, chat, bots, profiles } = await connected()
    await panel.configure("a", "chat", { ...enable, secrets: {}, profileSync: true })
    await settle()
    const [first] = profilesOf(chat.outputs)
    if (first === undefined) throw new Error("no profile")
    const bot = bots[0]
    if (bot === undefined) throw new Error("no bot")
    bot.name = "Alicia"
    profiles.refresh()
    await settle()
    chat.links[0]?.reportProfile({ digest: first.profile.digest, state: "synced" })
    expect(panel.snapshot("a").channels[0]?.profile?.status).toEqual({ state: "syncing" })
    const [, second] = profilesOf(chat.outputs)
    expect(second?.profile.name).toBe("Alicia")
    const problems = [{ en: "Discord refused the username" }]
    chat.links[0]?.reportProfile({
      digest: second?.profile.digest ?? "",
      state: "failed",
      problems,
    })
    expect(panel.snapshot("a").channels[0]?.profile?.status).toEqual({ state: "failed", problems })
  })

  it("follow a change of the name or avatar, and send nothing when neither changed", async () => {
    const { panel, chat, bots, profiles, drawn } = await connected()
    await panel.configure("a", "chat", { ...enable, secrets: {}, profileSync: true })
    await settle()
    profiles.refresh()
    await settle()
    expect(profilesOf(chat.outputs)).toHaveLength(1)
    const bot = bots[0]
    if (bot === undefined) throw new Error("no bot")
    bot.avatar = { kind: "image", dataUrl: "data:image/png;base64,AA" }
    profiles.refresh("a")
    await settle()
    expect(drawn).toEqual(["svg", "image"])
    expect(profilesOf(chat.outputs)).toHaveLength(2)
    expect(chat.links).toHaveLength(1)
  })

  it("send the profile again to a new connection, and stop when turned off", async () => {
    const { panel, chat } = await connected()
    await panel.configure("a", "chat", { ...enable, secrets: {}, profileSync: true })
    await settle()
    await panel.configure("a", "chat", {
      ...enable,
      secrets: { token: { op: "set", value: "tok-2" } },
      profileSync: true,
    })
    await settle()
    expect(chat.links).toHaveLength(2)
    expect(profilesOf(chat.outputs)).toHaveLength(2)
    await panel.configure("a", "chat", { ...enable, secrets: {}, profileSync: false })
    await settle()
    expect(chat.links).toHaveLength(2)
    expect(panel.snapshot("a").channels[0]?.profile).toEqual({
      supports: { name: true, avatar: true },
      sync: false,
    })
    await panel.configure("a", "chat", { ...enable, secrets: {}, profileSync: true })
    await settle()
    expect(profilesOf(chat.outputs)).toHaveLength(3)
  })

  it("carry only what the channel takes", async () => {
    const { panel, chat, drawn } = await connected({
      ...CAPABILITIES,
      profile: { name: true, avatar: false },
    })
    await panel.configure("a", "chat", { ...enable, secrets: {}, profileSync: true })
    await settle()
    expect(drawn).toEqual([])
    expect(profilesOf(chat.outputs)).toMatchObject([{ profile: { name: "Alice" } }])
    expect(profilesOf(chat.outputs)[0]).not.toHaveProperty("profile.avatar")
  })

  it("are not offered by a channel without the capability", async () => {
    const { panel, chat } = await connected(CAPABILITIES)
    expect(panel.snapshot("a").channels[0]).not.toHaveProperty("profile")
    await expect(
      panel.configure("a", "chat", { ...enable, secrets: {}, profileSync: true }),
    ).rejects.toThrow("does not take the bot's name and avatar")
    expect(profilesOf(chat.outputs)).toEqual([])
  })
})

const SHARED_FIELDS = [
  { kind: "secret", key: "apiKey", label: { en: "API key" }, required: true, maxLength: 64 },
  { kind: "text", key: "owner", label: { en: "Owner" }, required: false, maxLength: 32 },
] as const

function sharedChannel(
  base: ReturnType<typeof recordingChannel>,
  hooks: Partial<Pick<BotChannel, "initialSettings" | "accounts">> & {
    readonly check?: (
      shared: Record<string, unknown>,
    ) => { ok: true } | { ok: false; reason: { en: string } }
  } = {},
): BotChannel {
  return {
    ...base.channel,
    shared: {
      fields: SHARED_FIELDS,
      check: async ({ shared }) => hooks.check?.(shared) ?? { ok: true },
      inspect: async ({ shared }) => ({
        state: "ready",
        links: [],
        warnings: [{ en: `owner ${String(shared.owner)}` }],
        snippets: [{ label: { en: "Config" }, language: "text", text: "x" }],
      }),
      ...(hooks.initialSettings === undefined
        ? {}
        : {
            describeInitial: (shared) =>
              shared.owner === ""
                ? { state: "unavailable", reason: { en: "no owner" } }
                : { state: "ready", summary: { en: `DM with ${String(shared.owner)}` } },
          }),
    },
    ...(hooks.initialSettings === undefined ? {} : { initialSettings: hooks.initialSettings }),
    ...(hooks.accounts === undefined ? {} : { accounts: hooks.accounts }),
  }
}

const sharedChange = (owner: string, apiKey?: string, newBots = false) => ({
  values: { owner },
  secrets: apiKey === undefined ? {} : { apiKey: { op: "set", value: apiKey } },
  newBots,
})

describe("shared channel settings", () => {
  it("holds every bot of the channel as unconfigured until its shared settings are complete, then connects with them", async () => {
    const { panel, channels, shared } = setup()
    const chat = recordingChannel("chat", CAPABILITIES)
    channels.push(sharedChannel(chat))
    await panel.configure("a", "chat", enable)
    await settle()
    expect(panel.snapshot("a").channels[0]?.status).toEqual({ state: "unconfigured" })
    expect(chat.links).toEqual([])
    expect(shared.panel.snapshot().channels[0]).toMatchObject({
      status: { state: "incomplete", missing: ["apiKey"] },
      secrets: { apiKey: false },
      newBots: false,
    })
    expect(await shared.panel.configure("chat", sharedChange("alice", "k1"))).toMatchObject({
      saved: true,
      view: { status: { state: "ready" }, secrets: { apiKey: true }, values: { owner: "alice" } },
    })
    await settle()
    expect(chat.links.map((link) => link.shared)).toEqual([{ apiKey: "k1", owner: "alice" }])
    expect(shared.vault.stored.get("chat")).toEqual({ apiKey: "k1" })
    await shared.panel.configure("chat", sharedChange("bob"))
    await settle()
    expect(chat.links.map((link) => link.shared)).toEqual([
      { apiKey: "k1", owner: "alice" },
      { apiKey: "k1", owner: "bob" },
    ])
  })

  it("saves the shared settings only when the channel's shared check accepts them", async () => {
    const { channels, shared } = setup()
    const chat = recordingChannel("chat", CAPABILITIES)
    channels.push(
      sharedChannel(chat, {
        check: (values) =>
          values.owner === "mallory" ? { ok: false, reason: { en: "not mallory" } } : { ok: true },
      }),
    )
    expect(await shared.panel.configure("chat", sharedChange("mallory", "k"))).toEqual({
      saved: false,
      reason: { en: "not mallory" },
    })
    expect(shared.records.rows.size).toBe(0)
    await expect(
      shared.panel.configure("chat", { ...sharedChange("a", "k"), newBots: true }),
    ).rejects.toThrow("new bots")
  })

  it("answers the bot's queries as unavailable while unconfigured, and the shared ones through the shared hooks", async () => {
    const { panel, channels, shared } = setup()
    const chat = recordingChannel("chat", CAPABILITIES)
    channels.push(sharedChannel(chat))
    expect(await panel.inspect("chat", { kind: "bot", botId: "a" }, undefined)).toMatchObject({
      state: "unavailable",
      reason: { en: expect.stringContaining("dsh-bots settings") },
    })
    expect(
      await panel.inspect(
        "chat",
        { kind: "shared-draft", values: { owner: "dora" }, secrets: { apiKey: "typed" } },
        undefined,
      ),
    ).toMatchObject({ warnings: [{ en: "owner dora" }], snippets: [{ text: "x" }] })
    await shared.panel.configure("chat", sharedChange("eve", "k"))
    expect(await panel.inspect("chat", { kind: "shared" }, undefined)).toMatchObject({
      warnings: [{ en: "owner eve" }],
    })
  })

  it("turns a new bot's channel on with the channel's initial settings, or records why not", async () => {
    const { panel, channels, shared, settings } = setup()
    const chat = recordingChannel("chat", CAPABILITIES)
    const requests: unknown[] = []
    channels.push(
      sharedChannel(chat, {
        initialSettings: async (request) => {
          requests.push(request)
          return {
            state: "ready",
            values: { server: "", users: [String(request.shared.owner)] },
            secrets: { token: "tok" },
            profileSync: false,
            summary: { en: "DM" },
          }
        },
      }),
    )
    const warnings: string[] = []
    const initial = createInitialChannels({
      channel: (id) => channels.find((channel) => channel.id === id),
      defaults: () => shared.panel.defaults(),
      shared: (channel) => shared.panel.values(channel),
      configure: (botId, channelId, change) => panel.configure(botId, channelId, change),
      markFailed: (botId, channel, failure) => settings.markInitialFailed(botId, channel, failure),
      deadline: () => new AbortController().signal,
      now: () => 7,
      warn: (message) => warnings.push(message),
    })
    await initial.apply({ id: "a", name: "a", language: "ja" }, ["chat"])
    expect(panel.snapshot("a").channels[0]).toMatchObject({
      enabled: false,
      initial: { state: "failed", at: 7 },
    })
    await shared.panel.configure("chat", sharedChange("", "k", true))
    expect(shared.panel.defaults()).toEqual([
      {
        channelId: "chat",
        name: "Chat",
        initial: { state: "unavailable", reason: { en: "no owner" } },
      },
    ])
    await shared.panel.configure("chat", sharedChange("7", "k", true))
    expect(shared.panel.defaults()).toEqual([
      {
        channelId: "chat",
        name: "Chat",
        initial: { state: "ready", summary: { en: "DM with 7" } },
      },
    ])
    await initial.apply({ id: "a", name: "a", language: "ja" }, ["chat"])
    expect(requests).toMatchObject([
      { bot: { id: "a", language: "ja" }, shared: { owner: "7", apiKey: "k" } },
    ])
    const view = panel.snapshot("a").channels[0]
    expect(view).toMatchObject({
      enabled: true,
      values: { users: ["7"] },
      secrets: { token: true },
    })
    expect(view?.initial).toBeUndefined()
    expect(warnings).toHaveLength(1)
  })

  it("reconciles a channel's accounts once at a time, folding the calls made meanwhile into one", async () => {
    const { channels, shared } = setup()
    const chat = recordingChannel("chat", CAPABILITIES)
    let release: () => void = () => {}
    const calls: string[][] = []
    const listed = new Set(["a"])
    channels.push(
      sharedChannel(chat, {
        accounts: {
          async reconcile(request) {
            calls.push(["x", "a", "b"].filter((botId) => request.listed(botId)))
            await new Promise<void>((resolve) => {
              release = resolve
            })
          },
        },
      }),
    )
    const accounts = createAccountReconciler({
      channels: () => channels,
      ready: (channel) => shared.panel.ready(channel),
      shared: (channel) => shared.panel.values(channel),
      listed: (botId) => listed.has(botId),
      signal: () => new AbortController().signal,
      warn: () => {},
    })
    accounts.request()
    await settle()
    expect(calls).toEqual([])
    await shared.panel.configure("chat", sharedChange("o", "k"))
    accounts.request()
    await settle()
    accounts.request("chat")
    listed.add("b")
    accounts.request("chat")
    await settle()
    expect(calls).toEqual([["a"]])
    release()
    await settle()
    expect(calls).toEqual([["a"], ["a", "b"]])
    release()
    await accounts.idle()
  })
})
