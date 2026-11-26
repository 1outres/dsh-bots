import type {
  BotChannelCapabilities,
  BotChannelOutput,
  BotCommandId,
  BotCommandSpec,
} from "../../channel-contract"
import type { BotChannelDescriptor } from "../../shared/channels"
import { BOT_INTERACTION_KINDS } from "../../shared/interactions"

export const BOT_COMMANDS: readonly BotCommandSpec[] = [
  {
    id: "stop",
    description: {
      en: "Stop the bot's current turn (its queued messages stay)",
      ja: "ボットが実行中の処理を止めます（待機中のメッセージは残ります）",
    },
    access: "anyone",
  },
  {
    id: "status",
    description: {
      en: "Show whether the bot is busy, its model and its queue",
      ja: "ボットが処理中か、モデル、待機中のメッセージ数を表示します",
    },
    access: "anyone",
  },
  {
    id: "new",
    description: {
      en: "Start a new Main session (the current one is archived and kept)",
      ja: "新しい Main セッションを始めます（今のセッションはアーカイブして残します）",
    },
    access: "owners",
  },
]

const COMMAND_IDS: ReadonlySet<string> = new Set(BOT_COMMANDS.map((command) => command.id))
const INTERACTION_KINDS: ReadonlySet<string> = new Set(BOT_INTERACTION_KINDS)

export const MAX_CHANNEL_BYTES = 1024 * 1024 * 1024
export const MAX_CHANNEL_ATTACHMENTS = 100

function checkBytes(value: unknown, what: string): void {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > MAX_CHANNEL_BYTES
  ) {
    throw new Error(`${what} must be an integer from 1 to ${MAX_CHANNEL_BYTES}`)
  }
}

function checkDistinct(values: unknown, known: ReadonlySet<string>, what: string): void {
  if (!Array.isArray(values)) throw new Error(`${what} must be a list`)
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== "string" || !known.has(value)) {
      throw new Error(`${what} names ${JSON.stringify(value)}, which bot-core does not know`)
    }
    if (seen.has(value)) throw new Error(`${what} names ${JSON.stringify(value)} twice`)
    seen.add(value)
  }
}

function checkOwnersOutput(
  name: "connectorActions" | "credentialIncidents",
  value: unknown,
  owners: string | undefined,
  what: string,
): void {
  if (value === undefined) return
  if (value !== true) throw new Error(`${what}: ${name} must be true or absent`)
  if (owners === undefined) {
    throw new Error(`${what}: ${name} needs the channel to name its owners field`)
  }
}

export function checkChannelCapabilities(
  channel: Pick<BotChannelDescriptor, "id" | "owners">,
  capabilities: unknown,
): void {
  const what = `channel "${channel.id}" capabilities`
  if (typeof capabilities !== "object" || capabilities === null)
    throw new Error(`${what} are missing`)
  const value = capabilities as Partial<BotChannelCapabilities>
  if (value.attachments !== undefined) {
    const count = value.attachments.maxCount
    if (!Number.isSafeInteger(count) || count < 1 || count > MAX_CHANNEL_ATTACHMENTS) {
      throw new Error(
        `${what}: attachments.maxCount must be an integer from 1 to ${MAX_CHANNEL_ATTACHMENTS}`,
      )
    }
    checkBytes(value.attachments.maxBytes, `${what}: attachments.maxBytes`)
  }
  if (value.files !== undefined) checkBytes(value.files.maxBytes, `${what}: files.maxBytes`)
  if (typeof value.turns !== "boolean") throw new Error(`${what}: turns must be true or false`)
  checkDistinct(value.interactions, INTERACTION_KINDS, `${what}: interactions`)
  checkDistinct(value.commands, COMMAND_IDS, `${what}: commands`)
  const ownersOnly = (value.commands as readonly string[]).find(
    (id) => BOT_COMMANDS.find((command) => command.id === id)?.access === "owners",
  )
  if (ownersOnly !== undefined && channel.owners === undefined) {
    throw new Error(
      `${what}: command "${ownersOnly}" is for owners only and needs the channel to name its owners field`,
    )
  }
  checkOwnersOutput("connectorActions", value.connectorActions, channel.owners, what)
  checkOwnersOutput("credentialIncidents", value.credentialIncidents, channel.owners, what)
}

export function commandsOf(capabilities: BotChannelCapabilities): readonly BotCommandSpec[] {
  return capabilities.commands.map((id: BotCommandId) => {
    const spec = BOT_COMMANDS.find((command) => command.id === id)
    if (spec === undefined) throw new Error(`unknown command "${id}"`)
    return spec
  })
}

export function carries(capabilities: BotChannelCapabilities, output: BotChannelOutput): boolean {
  switch (output.kind) {
    case "reply":
      return true
    case "file":
      return (
        capabilities.files !== undefined &&
        output.file.data.byteLength <= capabilities.files.maxBytes
      )
    case "turn":
      return capabilities.turns
    case "interaction-opened":
    case "interaction-updated":
      return capabilities.interactions.includes(output.interaction.kind)
    case "interaction-closed":
      return capabilities.interactions.includes(output.closure.kind)
    case "connector-action":
      return capabilities.connectorActions === true
    case "credential-incident":
      return capabilities.credentialIncidents === true
  }
}
