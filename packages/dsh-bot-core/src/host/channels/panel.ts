import type { BotChannel, BotChannelSettingsRequest } from "../../contract"
import {
  type BotChannelChange,
  type BotChannelCheck,
  type BotChannelConfigureResult,
  type BotChannelDescriptor,
  type BotChannelInspection,
  type BotChannelOptions,
  type BotChannelProfileView,
  type BotChannelPublicValues,
  type BotChannelStatus,
  type BotChannelsSnapshot,
  type BotChannelView,
  missingChannelFields,
  parseChannelChange,
  parseChannelSettingsRef,
  sourceOf,
  withSecretValues,
} from "../../shared/channels"
import type { ChannelHub } from "./hub"
import type { ProfileSync } from "./profile/sync"
import type { ChannelSettings } from "./settings"
import {
  hasShared,
  type SharedChannelPanel,
  type SharedChannel as SharedChannelPanelChannel,
  unconfiguredReason,
} from "./shared-panel"

export interface ChannelPanelDeps {
  channels(): readonly BotChannel[]
  channel(id: string): BotChannel | undefined
  bot(botId: string): { readonly id: string; readonly name: string } | undefined
  listed(botId: string): boolean
  settings: Pick<
    ChannelSettings,
    "view" | "readiness" | "configure" | "revision" | "resolve" | "preview"
  >
  hub: Pick<ChannelHub, "state" | "sync">
  profiles: Pick<ProfileSync, "status">
  shared: SharedChannelPanel
  deadline(): AbortSignal
}

export interface ChannelPanel {
  snapshot(botId: string): BotChannelsSnapshot
  configure(botId: string, channelId: string, change: unknown): Promise<BotChannelConfigureResult>
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

export function descriptorOf(channel: BotChannel): BotChannelDescriptor {
  return {
    id: channel.id,
    name: channel.name,
    ...(channel.description === undefined ? {} : { description: channel.description }),
    ...(channel.guide === undefined ? {} : { guide: channel.guide }),
    ...(channel.setup === undefined ? {} : { setup: channel.setup }),
    fields: channel.fields,
    ...(channel.owners === undefined ? {} : { owners: channel.owners }),
    ...(channel.shared === undefined ? {} : { shared: true }),
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
    if (readiness.state === "off") return readiness
    if (!deps.shared.ready(channel)) return { state: "unconfigured" }
    if (readiness.state !== "ready") return readiness
    if (!deps.listed(botId)) return { state: "waiting" }
    return deps.hub.state(botId, channel.id) ?? { state: "connecting" }
  }

  const profileOf = (
    botId: string,
    channel: BotChannel,
    sync: boolean,
  ): BotChannelProfileView | undefined => {
    const supports = channel.capabilities.profile
    if (supports === undefined) return undefined
    const current = deps.profiles.status(botId, channel.id)
    return { supports, sync, ...(current === undefined ? {} : { status: current }) }
  }

  const view = (botId: string, channel: BotChannel): BotChannelView => {
    const { profileSync, ...settings } = deps.settings.view(botId, channel)
    const profile = profileOf(botId, channel, profileSync)
    return {
      channel: descriptorOf(channel),
      ...settings,
      status: status(botId, channel),
      revision: deps.settings.revision(botId, channel.id),
      ...(profile === undefined ? {} : { profile }),
    }
  }

  type Scoped =
    | { readonly scope: "bot"; readonly request: BotChannelSettingsRequest<BotChannelPublicValues> }
    | {
        readonly scope: "shared"
        readonly shared: BotChannelPublicValues
        readonly signal: AbortSignal
      }

  const requestOf = async (
    channel: BotChannel,
    input: unknown,
    caller: AbortSignal | undefined,
  ): Promise<Scoped> => {
    const timeout = deps.deadline()
    const signal = caller === undefined ? timeout : AbortSignal.any([caller, timeout])
    const ref = parseChannelSettingsRef(channel.fields, channel.shared?.fields, input)
    switch (ref.kind) {
      case "shared":
        return { scope: "shared", shared: await deps.shared.values(channel), signal }
      case "shared-draft":
        return {
          scope: "shared",
          shared: withSecretValues(channel.shared?.fields ?? [], ref.values, ref.secrets),
          signal,
        }
      case "bot": {
        const bot = requireBot(ref.botId)
        const settings = await deps.settings.resolve(bot.id, channel)
        const shared = await deps.shared.values(channel)
        return { scope: "bot", request: { bot, settings, shared, signal } }
      }
      case "draft": {
        const settings = withSecretValues(channel.fields, ref.values, ref.secrets)
        const shared = await deps.shared.values(channel)
        return { scope: "bot", request: { settings, shared, signal } }
      }
    }
  }

  const checkOf = (
    channel: BotChannel,
    request: BotChannelSettingsRequest<BotChannelPublicValues>,
  ) => (channel.check === undefined ? Promise.resolve(FITS) : channel.check(request as never))

  const complete = (channel: BotChannel, values: BotChannelPublicValues) =>
    missingChannelFields(channel.fields, values, (key) => values[key] !== "").length === 0

  const sharedScope = (channel: BotChannel): channel is SharedChannelPanelChannel =>
    hasShared(channel)

  return {
    snapshot(botId) {
      requireBot(botId)
      return { botId, channels: deps.channels().map((channel) => view(botId, channel)) }
    },
    async configure(botId, channelId, input) {
      const bot = requireBot(botId)
      const channel = requireChannel(channelId)
      const change: BotChannelChange = parseChannelChange(channel.fields, input)
      if (change.profileSync && channel.capabilities.profile === undefined) {
        throw new Error(`channel "${channelId}" does not take the bot's name and avatar`)
      }
      if (change.enabled && deps.shared.ready(channel)) {
        const settings = await deps.settings.preview(botId, channel, change)
        if (complete(channel, settings)) {
          const shared = await deps.shared.values(channel)
          const checked = await checkOf(channel, { bot, settings, shared, signal: deps.deadline() })
          if (!checked.ok) return { saved: false, reason: checked.reason }
        }
      }
      await deps.settings.configure(botId, channel, change)
      deps.hub.sync()
      return { saved: true, view: view(botId, channel) }
    },
    async options(channelId, settings, source, signal) {
      const channel = requireChannel(channelId)
      const scoped = await requestOf(channel, settings, signal)
      if (scoped.scope === "shared") {
        if (!sharedScope(channel)) throw new Error(`channel "${channelId}" has no shared settings`)
        return deps.shared.options(channel, scoped.shared, source, scoped.signal)
      }
      if (
        typeof source !== "string" ||
        channel.options === undefined ||
        !channel.fields.some((field) => sourceOf(field) === source)
      ) {
        throw new Error(`channel "${channelId}" has no source ${JSON.stringify(source)}`)
      }
      if (!deps.shared.ready(channel))
        return { state: "unavailable", reason: unconfiguredReason(channel) }
      return channel.options({ ...scoped.request, source } as never)
    },
    async inspect(channelId, settings, signal) {
      const channel = requireChannel(channelId)
      const scoped = await requestOf(channel, settings, signal)
      if (scoped.scope === "shared") {
        if (!sharedScope(channel)) throw new Error(`channel "${channelId}" has no shared settings`)
        return deps.shared.inspect(channel, scoped.shared, scoped.signal)
      }
      if (!deps.shared.ready(channel))
        return { state: "unavailable", reason: unconfiguredReason(channel) }
      return channel.inspect === undefined
        ? NOTHING_TO_INSPECT
        : channel.inspect(scoped.request as never)
    },
    async check(channelId, settings, signal) {
      const channel = requireChannel(channelId)
      const scoped = await requestOf(channel, settings, signal)
      if (scoped.scope === "shared") {
        if (!sharedScope(channel)) throw new Error(`channel "${channelId}" has no shared settings`)
        return deps.shared.check(channel, scoped.shared, scoped.signal)
      }
      if (!deps.shared.ready(channel)) return FITS
      return complete(channel, scoped.request.settings) ? checkOf(channel, scoped.request) : FITS
    },
  }
}
