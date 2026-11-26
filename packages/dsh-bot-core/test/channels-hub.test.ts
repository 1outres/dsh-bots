import { describe, expect, it } from "vitest"
import type { BotChannel } from "../src/contract"
import type { ConversationDeps } from "../src/host/channels/conversation"
import type { ChannelRecord } from "../src/host/channels/domain"
import { createChannelHub } from "../src/host/channels/hub"
import { createChannelOutlets } from "../src/host/channels/outlets"
import { createChannelPanel } from "../src/host/channels/panel"
import { createChannelSettings } from "../src/host/channels/settings"
import { createConnectorApprovals } from "../src/host/connectors/approvals"
import { createInteractionBoard } from "../src/host/interactions/board"
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
  const bots = [{ id: "a", name: "Alice" }]
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
    async compose({ message, header }) {
      return {
        ok: true,
        content: [{ type: "text", text: `${header}\n${message.text}` }],
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
  const hub = createChannelHub({
    channels: () => channels,
    bots: () => bots,
    settings,
    conversation,
    outlets,
    interactions,
    approvals,
    incidents: { open: (botId) => (botId === "a" ? [openIncident] : []) },
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
    deadline: () => new AbortController().signal,
  })
  return {
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
    bots.push({ id: "a", name: "Alice" })
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
