import type { BotChannel } from "../../contract"
import {
  type BotChannelDescriptor,
  type BotChannelStatus,
  type BotChannelsSnapshot,
  type BotChannelView,
  parseChannelChange,
} from "../../shared/channels"
import type { ChannelHub } from "./hub"
import type { ChannelSettings } from "./settings"

export interface ChannelPanelDeps {
  channels(): readonly BotChannel[]
  channel(id: string): BotChannel | undefined
  /** Whether the bot is stored (listed or being created). */
  exists(botId: string): boolean
  /** Whether the bot is listed (has its Main session). */
  listed(botId: string): boolean
  settings: Pick<ChannelSettings, "view" | "readiness" | "configure">
  hub: Pick<ChannelHub, "state" | "sync">
}

/** What the `botChannels` Remote serves: each bot's channel settings and their status. */
export interface ChannelPanel {
  /** @throws when the bot does not exist. */
  snapshot(botId: string): BotChannelsSnapshot
  /**
   * Store a change from the browser (parsed against the channel's fields) and apply it.
   * @throws when the bot or channel does not exist or the change is invalid.
   */
  configure(botId: string, channelId: string, change: unknown): Promise<BotChannelView>
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

export function createChannelPanel(deps: ChannelPanelDeps): ChannelPanel {
  const requireBot = (botId: string) => {
    if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
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
  })

  return {
    snapshot(botId) {
      requireBot(botId)
      return { botId, channels: deps.channels().map((channel) => view(botId, channel)) }
    },
    async configure(botId, channelId, input) {
      requireBot(botId)
      const channel = deps.channel(channelId)
      if (channel === undefined) throw new Error(`channel "${channelId}" is not registered`)
      const change = parseChannelChange(channel.fields, input)
      await deps.settings.configure(botId, channel, change)
      deps.hub.sync()
      return view(botId, channel)
    },
  }
}
