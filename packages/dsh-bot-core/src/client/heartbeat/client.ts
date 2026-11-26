import type { BotHeartbeatView, HeartbeatSettings } from "../../shared/heartbeat"
import type { Observable } from "../observable"
import type { BotHeartbeatRemote, RemoteMount } from "../remote"
import { type FeedState, followed, mountedRemote, unwrap } from "../remote-feed"

export type { FeedState } from "../remote-feed"

export interface HeartbeatClient {
  bot(botId: string): Observable<FeedState<BotHeartbeatView>>
  configure(botId: string, settings: HeartbeatSettings): Promise<BotHeartbeatView>
}

async function heartbeatOf(mount: Promise<RemoteMount>): Promise<BotHeartbeatRemote> {
  return (await mountedRemote(mount)).botHeartbeat
}

export function createHeartbeatClient(mount: Promise<RemoteMount>): HeartbeatClient {
  const bots = new Map<string, Observable<FeedState<BotHeartbeatView>>>()
  return {
    bot(botId) {
      let feed = bots.get(botId)
      if (feed === undefined) {
        feed = followed(
          (remote: BotHeartbeatRemote) => remote.watch(botId),
          () => heartbeatOf(mount),
        )
        bots.set(botId, feed)
      }
      return feed
    },
    configure: async (botId, settings) =>
      unwrap(await (await heartbeatOf(mount)).configure(botId, settings)),
  }
}
