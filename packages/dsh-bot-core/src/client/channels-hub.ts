import type { BotChannelChange, BotChannelView } from "../shared/channels"
import { askAbout, type ChannelAsk, type ChannelQueries } from "./channel-queries"
import type { ChannelsModel, ChannelsState } from "./channels-model"
import { createFeedHub } from "./feed-hub"
import type { Observable } from "./observable"

/** One bot's channel settings, streamed while anything subscribes. */
export interface ChannelsFeed extends Observable<ChannelsState> {
  /** Save one channel's change; rejects with a `ChannelsError`. */
  configure(channelId: string, change: BotChannelChange): Promise<BotChannelView>
}

/**
 * Bots' channel settings shared by everything that shows them (the settings
 * section and its nav badge): one stream per bot, opened by the first
 * subscriber and closed after the last.
 */
export interface ChannelsHub {
  feed(botId: string): ChannelsFeed
  /** Questions about a bot's stored settings of one channel. */
  ask(botId: string, channelId: string): ChannelAsk
}

export function createChannelsHub(
  open: (botId: string) => ChannelsModel,
  queries: ChannelQueries,
): ChannelsHub {
  const feeds = createFeedHub<ChannelsState, ChannelsModel, Pick<ChannelsFeed, "configure">>({
    name: "channels",
    idle: { status: "loading" },
    open,
    extend: (followed) => ({
      configure: async (channelId, change) => followed().configure(channelId, change),
    }),
  })
  return {
    feed: (botId) => feeds.feed(botId),
    ask: (botId, channelId) => askAbout(queries, channelId, () => ({ kind: "bot", botId })),
  }
}
