import type { ChannelQueries } from "../src/client/channel-queries"
import type {
  BotChannel,
  BotChannelCapabilities,
  BotChannelConnection,
  BotChannelLink,
  BotChannelOutput,
  BotInboundMessage,
  BotMessageSender,
} from "../src/contract"
import type { ChannelRecord } from "../src/host/channels/domain"
import { createMainFeed, type MainFeedDeps } from "../src/host/channels/feed"
import { createPresentedFiles } from "../src/host/channels/presented"
import { createChannelSequence } from "../src/host/channels/sequence"
import type { SecretVault } from "../src/host/channels/vault"
import type { BotTable } from "../src/host/registry"
import type { BotChannelField } from "../src/shared/channels"

export const FIELDS = [
  {
    kind: "secret",
    key: "token",
    label: { en: "Token", ja: "トークン" },
    required: true,
    maxLength: 64,
  },
  {
    kind: "text",
    key: "server",
    label: { en: "Server" },
    required: false,
    maxLength: 32,
    pattern: "[a-z]+",
  },
  {
    kind: "list",
    key: "users",
    label: { en: "Users" },
    minItems: 1,
    maxItems: 3,
    item: { maxLength: 8, pattern: "[0-9]+" },
  },
] as const satisfies readonly BotChannelField[]

export function memoryTable<V>(): BotTable<V> & { rows: Map<string, V> } {
  const rows = new Map<string, V>()
  return {
    rows,
    get: (key) => rows.get(key),
    entries: () => rows.entries(),
    async put(key, value) {
      rows.set(key, value)
    },
    async delete(key) {
      return rows.delete(key)
    },
  }
}

export function memoryVault(): SecretVault & { stored: Map<string, Record<string, string>> } {
  const stored = new Map<string, Record<string, string>>()
  return {
    stored,
    async read(botId, channelId) {
      return { ...(stored.get(`${botId}:${channelId}`) ?? {}) }
    },
    async write(botId, channelId, secrets) {
      if (Object.keys(secrets).length === 0) stored.delete(`${botId}:${channelId}`)
      else stored.set(`${botId}:${channelId}`, { ...secrets })
    },
  }
}

export type ChannelTable = ReturnType<typeof memoryTable<ChannelRecord>>

export const CAPABILITIES: BotChannelCapabilities = {
  attachments: { maxCount: 4, maxBytes: 1000 },
  files: { maxBytes: 100 },
  turns: true,
  interactions: ["question"],
  commands: ["status", "stop"],
}

export const DECIDING: BotChannelCapabilities = { ...CAPABILITIES, connectorActions: true }

export const SENDER: BotMessageSender = {
  id: "1",
  displayName: "Alice",
  handle: "alice",
  bot: false,
}

export function inboundMessage(
  text: string,
  overrides: Partial<BotInboundMessage> = {},
): BotInboundMessage {
  return {
    place: { kind: "direct" },
    sender: SENDER,
    sentAt: 0,
    text,
    attachments: [],
    ...overrides,
  }
}

export function recordingChannel(
  id = "chat",
  capabilities: BotChannelCapabilities = CAPABILITIES,
  owners: "users" | undefined = capabilities.connectorActions === true ? "users" : undefined,
) {
  const links: BotChannelLink[] = []
  const closed: BotChannelLink[] = []
  const outputs: BotChannelOutput[] = []
  const channel: BotChannel<typeof FIELDS> = {
    id,
    name: "Chat",
    fields: FIELDS,
    ...(owners === undefined ? {} : { owners }),
    capabilities,
    connect(link): BotChannelConnection {
      links.push(link as BotChannelLink)
      return {
        async receive(output) {
          outputs.push(output)
        },
        async close() {
          closed.push(link as BotChannelLink)
        },
      }
    },
  }
  return { channel: channel as unknown as BotChannel, links, closed, outputs }
}

export async function settle(rounds = 10): Promise<void> {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve()
  await new Promise((resolve) => setImmediate(resolve))
}

export function mainFeed(
  deps: Pick<MainFeedDeps, "botOfMainSession" | "isSilent"> & {
    publish(botId: string, output: BotChannelOutput): void
    deliverFiles?: MainFeedDeps["deliverFiles"]
    isMaintenance?: MainFeedDeps["isMaintenance"]
  },
): ReturnType<typeof createMainFeed> {
  return createMainFeed({
    botOfMainSession: deps.botOfMainSession,
    isSilent: deps.isSilent,
    isMaintenance: deps.isMaintenance ?? (() => false),
    presented: createPresentedFiles(),
    sequence: createChannelSequence({ publish: deps.publish, warn: () => {} }),
    deliverFiles: deps.deliverFiles ?? (async () => {}),
  })
}

export const idleQueries: ChannelQueries = {
  options: async () => ({ state: "unavailable", reason: { en: "Nothing to ask" } }),
  inspect: async () => ({ state: "ready", links: [], warnings: [] }),
  check: async () => ({ ok: true }),
}
