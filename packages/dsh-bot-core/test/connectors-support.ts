import { defineConnectorTool } from "../src/connector-contract"
import type {
  BotConnector,
  BotConnectorConnection,
  BotConnectorEnvironment,
  BotConnectorRun,
} from "../src/contract"
import { createConnectorAccounts } from "../src/host/connections/accounts"
import type { ClientRecord, ConnectionRecord, GrantRecord } from "../src/host/connections/domain"
import { connectionInfo, createConnectionStore } from "../src/host/connections/store"
import { createConnectorAttachments } from "../src/host/connectors/attachments"
import { createConnectorBroker } from "../src/host/connectors/broker"
import { createConnectorCatalog } from "../src/host/connectors/catalog"
import { createDeadlines } from "../src/host/connectors/deadlines"
import type { PermissionRecord, SettingsRecord } from "../src/host/connectors/domain"
import { createExclusiveRuns } from "../src/host/connectors/exclusive"
import { createRunImages, type ImageServices } from "../src/host/connectors/images"
import { createConnectorLedger } from "../src/host/connectors/ledger"
import { createConnectorPermissions } from "../src/host/connectors/permissions"
import { createConnectorReadiness, type EnvironmentState } from "../src/host/connectors/readiness"
import { operatedRequirement } from "../src/host/connectors/requirements"
import { createConnectorRuns } from "../src/host/connectors/runs"
import { createConnectorSettings } from "../src/host/connectors/settings"
import { createConnectorStatuses } from "../src/host/connectors/statuses"
import { createConnectorStreams } from "../src/host/connectors/streams"
import type { ConnectorNotice } from "../src/host/connectors/texts"
import type { CursorRecord, EventRecord } from "../src/host/events/domain"
import { createEventStore } from "../src/host/events/store"
import { createConnectorOwnTools } from "../src/host/events/tools"
import { createSaveQueue } from "../src/host/save-queue"
import type { VaultAccessContext, VaultRun } from "../src/host/vaults/access"
import type { ConnectorAction } from "../src/shared/connectors"
import { type BotEnvironmentSpec, DEFAULT_BOT_ENVIRONMENT_SPEC } from "../src/shared/environment"
import { memoryTable } from "./channels-support"

/** A bot without logins: every use of the vault is refused. */
const refusingVault = (): VaultRun => ({
  access: {
    describe: async () => {
      throw new Error("not one of this bot's credentials")
    },
    reveal: async () => {
      throw new Error("not one of this bot's credentials")
    },
    passkey: async () => {
      throw new Error("not one of this bot's credentials")
    },
  },
  release() {},
})

/** A manual clock: timers run only when the test advances it. */
export function manualClock(start = 1_000_000) {
  let now = start
  let next = 0
  const timers = new Map<number, { at: number; work: () => void }>()
  return {
    now: () => now,
    later(ms: number, work: () => void) {
      const id = next++
      timers.set(id, { at: now + ms, work })
      return () => {
        timers.delete(id)
      }
    },
    async advance(ms: number) {
      await settle()
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        timers.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].work()
        await settle()
      }
      now = target
      await settle()
    },
    pending: () => timers.size,
  }
}

/** Let queued promise work run. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}

/** A test connector: `echo` runs at once, `send` asks first, `hidden` is never shown. */
export function mailConnector(
  log: string[] = [],
  options: { recheck?: string } = {},
): BotConnector {
  return {
    id: "mail",
    name: "Mail",
    sessions: "main",
    tools: [
      defineConnectorTool({
        name: "echo",
        description: "Echo a text.",
        parameters: { text: { type: "string", required: true } },
        permission: "allow",
        preview: (args) => ({ title: `Echo ${args.text}?`, fields: [] }),
        async execute(args) {
          log.push(`echo ${args.text}`)
          return { data: { echoed: args.text } }
        },
      }),
      defineConnectorTool({
        name: "send",
        description: "Send an email.",
        parameters: {
          to: { type: "string", required: true },
          body: { type: "string", required: true },
        },
        permission: "ask",
        ask: { waitMs: 1_000, ttlMs: 10_000 },
        preview: (args) => ({
          title: "Send this email?",
          fields: [{ label: "To", value: args.to }],
          body: args.body,
        }),
        ...(options.recheck === undefined
          ? {}
          : {
              recheck: async () => ({ proceed: false as const, reason: options.recheck as string }),
            }),
        async execute(args, run: BotConnectorRun) {
          log.push(`send ${args.to} ${run.trigger.kind}`)
          return { data: { sent: true } }
        },
      }),
      defineConnectorTool({
        name: "hidden",
        description: "Never shown.",
        parameters: {},
        permission: "disallow",
        preview: () => ({ title: "Hidden?", fields: [] }),
        async execute() {
          log.push("hidden")
          return {}
        },
      }),
    ],
  }
}

/** An environment whose every call fails: the test connectors never reach one. */
export const NO_ENVIRONMENT: BotConnectorEnvironment = {
  workspace: "/home/bot/workspace",
  exec: () => Promise.reject(new Error("no environment")),
  spawn: () => Promise.reject(new Error("no environment")),
  readFile: () => Promise.reject(new Error("no environment")),
  writeFile: () => Promise.reject(new Error("no environment")),
}

export function brokerSetup(
  options: {
    recheck?: string
    actions?: Map<string, ConnectorAction>
    environment?: (botId: string) => EnvironmentState
    connectorEnvironment?: BotConnectorEnvironment
    images?: ImageServices
    connection?: (record: ConnectionRecord) => BotConnectorConnection
    vault?: (context: VaultAccessContext) => VaultRun
  } = {},
) {
  const clock = manualClock()
  const log: string[] = []
  const notices: { botId: string; notice: ConnectorNotice }[] = []
  const catalog = createConnectorCatalog()
  const actions = memoryTable<ConnectorAction>()
  for (const [id, action] of options.actions ?? []) actions.rows.set(id, action)
  const records = memoryTable<PermissionRecord>()
  const permissions = createConnectorPermissions({ records, catalog, now: clock.now })
  const ledger = createConnectorLedger({ actions, warn: (message) => log.push(`warn ${message}`) })
  const settingsRecords = memoryTable<SettingsRecord>()
  const settings = createConnectorSettings({
    records: settingsRecords,
    catalog,
    queue: createSaveQueue(),
    spec: () => DEFAULT_BOT_ENVIRONMENT_SPEC,
    now: clock.now,
  })
  const attachments = createConnectorAttachments({ warn: (message) => log.push(`warn ${message}`) })
  const connectionStore = createConnectionStore({
    connections: memoryTable<ConnectionRecord>(),
    grants: memoryTable<GrantRecord>(),
    clients: memoryTable<ClientRecord>(),
    now: clock.now,
  })
  const accounts = createConnectorAccounts(connectionStore)
  let eventIds = 0
  const eventStore = createEventStore({
    events: memoryTable<EventRecord>(),
    cursors: memoryTable<CursorRecord>(),
    newId: () => `evt-${++eventIds}`,
    now: clock.now,
    maxPerStream: 5,
    retentionMs: 60_000,
    unreadRetentionMs: 120_000,
  })
  const tokens: string[] = []
  const subscribeAccounts = (listener: () => void) => connectionStore.subscribe(listener)
  let imageIds = 0
  const runs = createConnectorRuns({
    bot: (botId) => (botId === "gone" ? undefined : { id: botId, name: "Mia" }),
    settings,
    environment: () => options.connectorEnvironment ?? NO_ENVIRONMENT,
    attachments,
    images: (sessionId, signal) =>
      createRunImages(
        {
          services: () => options.images,
          route: () => ({ provider: "p", model: "m" }),
          newId: () => `img-${++imageIds}`,
        },
        sessionId,
        signal,
      ),
    vault: options.vault ?? refusingVault,
    connection:
      options.connection ??
      ((record) => ({
        info: connectionInfo(record),
        async accessToken() {
          tokens.push(record.id)
          return `token-${record.id}`
        },
      })),
  })
  const bots = new Set(["b1", "b2", "gone"])
  const readiness = createConnectorReadiness({
    catalog,
    settings,
    bots: () => bots,
    exists: (botId) => bots.has(botId),
    environment: options.environment ?? (() => ({ ready: true, generation: "g1" })),
    accounts: (botId, connector) => accounts.problem(botId, connector),
    context: (botId, connector, signal) => runs.context(botId, connector, signal),
    now: clock.now,
    later: clock.later,
    warn: (message) => log.push(`warn ${message}`),
  })
  catalog.subscribe(() => readiness.sync())
  connectionStore.subscribe(() => readiness.sync())
  settings.subscribe((botId) => readiness.sync(botId))
  const statuses = createConnectorStatuses({
    catalog,
    settings,
    warn: (message) => log.push(`warn ${message}`),
  })
  const streams = createConnectorStreams({
    catalog,
    readiness,
    exists: (botId) => bots.has(botId),
    context: (botId, connector, signal) => runs.context(botId, connector, signal),
  })
  readiness.subscribe((botId, connectorId) => {
    if (readiness.state(botId, connectorId).state !== "ready") {
      attachments.release(botId, connectorId)
      streams.release(botId, connectorId)
    }
  })
  /** Turn a registered connector on for bots (default b1 and b2). */
  const enable = async (
    connector: BotConnector<unknown>,
    botIds = ["b1", "b2", "gone"],
    values = {},
  ) => {
    for (const botId of botIds)
      await settings.configure(botId, connector, { enabled: true, values })
  }
  let ids = 0
  const broker = createConnectorBroker({
    catalog,
    shield: async (_botId, _tool, value) => value,
    permissions,
    ledger,
    deadlines: createDeadlines({ later: clock.later, now: clock.now, maxDelayMs: 2_000 }),
    readiness,
    runs,
    accounts,
    exclusive: createExclusiveRuns(),
    operated: (botId, connector) =>
      operatedRequirement(connector, {
        get: (id) => catalog.get(id),
        status: (required) => statuses.read(botId, required),
      }),
    async notify(botId, notice) {
      notices.push({ botId, notice })
    },
    newId: () => `act-${++ids}`,
    now: clock.now,
    later: clock.later,
    retentionMs: 60_000,
    warn: (message) => log.push(`warn ${message}`),
  })
  const connector = mailConnector(log, options)
  const own = createConnectorOwnTools({
    catalog,
    accounts,
    store: eventStore,
    account: (connectionId) => connectionId,
    newNonce: () => "nonce",
  })
  return {
    spec: (_botId: string) => DEFAULT_BOT_ENVIRONMENT_SPEC as BotEnvironmentSpec | undefined,
    subscribeSpecs: (_listener: (botId: string) => void) => () => {},
    connectionStore,
    accounts,
    eventStore,
    tokens,
    subscribeAccounts,
    usableAccounts: (botId: string, connector: BotConnector<unknown>) =>
      accounts.usable(botId, connector).map((record) => record.id),
    waiting: (botId: string, connectorId: string) => eventStore.unread(botId, connectorId).length,
    own,
    clock,
    log,
    notices,
    catalog,
    actions,
    permissions,
    ledger,
    broker,
    connector,
    settings,
    settingsRecords,
    readiness,
    runs,
    attachments,
    statuses,
    streams,
    bots,
    enable,
  }
}

export const call = (tool: string, args: Record<string, string>, botId = "b1") => ({
  botId,
  sessionId: "main-1",
  connectorId: "mail",
  tool,
  args,
})
