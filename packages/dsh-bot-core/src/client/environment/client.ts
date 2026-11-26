import type { BotEnvironmentSpec, BotEnvironmentView } from "../../shared/environment"
import type { Observable } from "../observable"
import type { BotEnvironmentRemote, RemoteMount } from "../remote"
import { type FeedState, followed, mountedRemote, unwrap } from "../remote-feed"
import type { RemoteResult } from "../types"

export type { FeedState } from "../remote-feed"

export interface EnvironmentClient {
  bot(botId: string): Observable<FeedState<BotEnvironmentView>>
  configure(botId: string, spec: BotEnvironmentSpec): Promise<BotEnvironmentView>
}

async function environmentOf(mount: Promise<RemoteMount>): Promise<BotEnvironmentRemote> {
  return (await mountedRemote(mount)).botEnvironment
}

export function createEnvironmentClient(mount: Promise<RemoteMount>): EnvironmentClient {
  const bots = new Map<string, Observable<FeedState<BotEnvironmentView>>>()
  const call = async <T>(run: (remote: BotEnvironmentRemote) => Promise<RemoteResult<T>>) =>
    unwrap(await run(await environmentOf(mount)))
  return {
    bot(botId) {
      let feed = bots.get(botId)
      if (feed === undefined) {
        feed = followed(
          (remote: BotEnvironmentRemote) => remote.watch(botId),
          () => environmentOf(mount),
        )
        bots.set(botId, feed)
      }
      return feed
    },
    configure: (botId, spec) => call((remote) => remote.configure(botId, spec)),
  }
}
