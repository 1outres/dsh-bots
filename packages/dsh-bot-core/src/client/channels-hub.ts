import type { BotChannelChange, BotChannelView } from "../shared/channels"
import { askAbout, type ChannelAsk, type ChannelQueries } from "./channel-queries"
import type { ChannelsModel, ChannelsState } from "./channels-model"
import { createFeedHub } from "./feed-hub"
import type { Observable } from "./observable"

export interface ChannelsFeed extends Observable<ChannelsState> {
  configure(channelId: string, change: BotChannelChange): Promise<BotChannelView>
}

export interface ChannelsHub {
  feed(botId: string): ChannelsFeed
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
