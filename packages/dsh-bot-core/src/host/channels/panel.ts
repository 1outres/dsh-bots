import type { BotChannel, BotChannelSettingsRequest } from "../../contract"
import {
  type BotChannelChange,
  type BotChannelCheck,
  type BotChannelConfigureResult,
  type BotChannelDescriptor,
  type BotChannelInspection,
  type BotChannelOptions,
  type BotChannelPublicValues,
  type BotChannelStatus,
  type BotChannelsSnapshot,
  type BotChannelView,
  channelValuesOf,
  missingChannelFields,
  parseChannelChange,
  parseChannelSettingsRef,
  sourceOf,
} from "../../shared/channels"
import type { ChannelHub } from "./hub"
import type { ChannelSettings } from "./settings"

export interface ChannelPanelDeps {
  channels(): readonly BotChannel[]
  channel(id: string): BotChannel | undefined
  /** The stored bot (listed or being created), by id. */
  bot(botId: string): { readonly id: string; readonly name: string } | undefined
  /** Whether the bot is listed (has its Main session). */
  listed(botId: string): boolean
  settings: Pick<
    ChannelSettings,
    "view" | "readiness" | "configure" | "revision" | "resolve" | "preview"
  >
  hub: Pick<ChannelHub, "state" | "sync">
  /** A signal that aborts once a channel took too long to answer about settings. */
  deadline(): AbortSignal
}

/** What the `botChannels` Remote serves: each bot's channel settings, their status, and the channels' answers about settings. */
export interface ChannelPanel {
  /** @throws when the bot does not exist. */
  snapshot(botId: string): BotChannelsSnapshot
  /**
   * Store a change from the browser (parsed against the channel's fields, then
   * checked by the channel when it leaves the settings enabled and complete) and apply it.
   * @throws when the bot or channel does not exist or the change is invalid.
   */
  configure(botId: string, channelId: string, change: unknown): Promise<BotChannelConfigureResult>
  /** @throws when the channel or the bot does not exist, the reference is invalid or the source unknown. */
  options(
    channelId: string,
    settings: unknown,
    source: unknown,
    signal: AbortSignal | undefined,
  ): Promise<BotChannelOptions>
  inspect(
    channelId: string,
    settings: unknown,
    signal: AbortSignal | undefined,
  ): Promise<BotChannelInspection>
  check(
    channelId: string,
    settings: unknown,
    signal: AbortSignal | undefined,
  ): Promise<BotChannelCheck>
}

/** Only what the browser needs to render the form: no plugin methods. */
export function descriptorOf(channel: BotChannel): BotChannelDescriptor {
  return {
    id: channel.id,
    name: channel.name,
    ...(channel.description === undefined ? {} : { description: channel.description }),
    ...(channel.guide === undefined ? {} : { guide: channel.guide }),
    ...(channel.setup === undefined ? {} : { setup: channel.setup }),
    fields: channel.fields,
    ...(channel.owners === undefined ? {} : { owners: channel.owners }),
  }
}

const NOTHING_TO_INSPECT: BotChannelInspection = { state: "ready", links: [], warnings: [] }
const FITS: BotChannelCheck = { ok: true }

export function createChannelPanel(deps: ChannelPanelDeps): ChannelPanel {
  const requireBot = (botId: string) => {
    const bot = deps.bot(botId)
    if (bot === undefined) throw new Error(`bot "${botId}" does not exist`)
    return bot
  }
  const requireChannel = (channelId: string) => {
    const channel = deps.channel(channelId)
    if (channel === undefined) throw new Error(`channel "${channelId}" is not registered`)
    return channel
  }

  const status = (botId: string, channel: BotChannel): BotChannelStatus => {
    const readiness = deps.settings.readiness(botId, channel)
    if (readiness.state !== "ready") return readiness
    if (!deps.listed(botId)) return { state: "waiting" }
    return deps.hub.state(botId, channel.id) ?? { state: "connecting" }
  }

  const view = (botId: string, channel: BotChannel): BotChannelView => ({
    channel: descriptorOf(channel),
    ...deps.settings.view(botId, channel),
    status: status(botId, channel),
    revision: deps.settings.revision(botId, channel.id),
  })

  /** The request a settings reference makes: a bot's stored settings, or a draft's. */
  const requestOf = async (
    channel: BotChannel,
    input: unknown,
    caller: AbortSignal | undefined,
  ): Promise<BotChannelSettingsRequest<BotChannelPublicValues>> => {
    const timeout = deps.deadline()
    const signal = caller === undefined ? timeout : AbortSignal.any([caller, timeout])
    const ref = parseChannelSettingsRef(channel.fields, input)
    if (ref.kind === "bot") {
      const bot = requireBot(ref.botId)
      return { bot, settings: await deps.settings.resolve(bot.id, channel), signal }
    }
    const settings: Record<string, string | readonly string[]> = {
      ...channelValuesOf(channel.fields, ref.values),
    }
    for (const field of channel.fields) {
      if (field.kind === "secret") settings[field.key] = ref.secrets[field.key] ?? ""
    }
    return { settings, signal }
  }

  const checkOf = (
    channel: BotChannel,
    request: BotChannelSettingsRequest<BotChannelPublicValues>,
  ) => (channel.check === undefined ? Promise.resolve(FITS) : channel.check(request as never))

  const complete = (channel: BotChannel, values: BotChannelPublicValues) =>
    missingChannelFields(channel.fields, values, (key) => values[key] !== "").length === 0

  return {
    snapshot(botId) {
      requireBot(botId)
      return { botId, channels: deps.channels().map((channel) => view(botId, channel)) }
    },
    async configure(botId, channelId, input) {
      const bot = requireBot(botId)
      const channel = requireChannel(channelId)
      const change: BotChannelChange = parseChannelChange(channel.fields, input)
      if (change.enabled) {
        const settings = await deps.settings.preview(botId, channel, change)
        if (complete(channel, settings)) {
          const checked = await checkOf(channel, { bot, settings, signal: deps.deadline() })
          if (!checked.ok) return { saved: false, reason: checked.reason }
        }
      }
      await deps.settings.configure(botId, channel, change)
      deps.hub.sync()
      return { saved: true, view: view(botId, channel) }
    },
    async options(channelId, settings, source, signal) {
      const channel = requireChannel(channelId)
      if (
        typeof source !== "string" ||
        channel.options === undefined ||
        !channel.fields.some((field) => sourceOf(field) === source)
      ) {
        throw new Error(`channel "${channelId}" has no source ${JSON.stringify(source)}`)
      }
      const request = await requestOf(channel, settings, signal)
      return channel.options({ ...request, source } as never)
    },
    async inspect(channelId, settings, signal) {
      const channel = requireChannel(channelId)
      const request = await requestOf(channel, settings, signal)
      return channel.inspect === undefined ? NOTHING_TO_INSPECT : channel.inspect(request as never)
    },
    async check(channelId, settings, signal) {
      const channel = requireChannel(channelId)
      const request = await requestOf(channel, settings, signal)
      return complete(channel, request.settings) ? checkOf(channel, request) : FITS
    },
  }
}
