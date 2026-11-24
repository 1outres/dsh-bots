import type {
  BotMainsView,
  MainRotationOutcome,
  MainRotationOverride,
  MainRotationSettings,
} from "../../shared/mains"
import type { Observable } from "../observable"
import type { BotMainsRemote, RemoteMount } from "../remote"
import { type FeedState, followed, mountedRemote, unwrap } from "../remote-feed"
import type { RemoteResult } from "../types"

export type { FeedState } from "../remote-feed"

/** The `botMains` Remote for the browser: shared streams while anything subscribes, and calls that reject with the Host's message. */
export interface MainsClient {
  defaults: Observable<FeedState<MainRotationSettings>>
  bot(botId: string): Observable<FeedState<BotMainsView>>
  setDefaults(settings: MainRotationSettings): Promise<MainRotationSettings>
  configure(botId: string, override: MainRotationOverride): Promise<BotMainsView>
  startNew(botId: string): Promise<MainRotationOutcome>
}

async function mainsOf(mount: Promise<RemoteMount>): Promise<BotMainsRemote> {
  return (await mountedRemote(mount)).botMains
}

export function createMainsClient(mount: Promise<RemoteMount>): MainsClient {
  const bots = new Map<string, Observable<FeedState<BotMainsView>>>()
  const call = async <T>(run: (remote: BotMainsRemote) => Promise<RemoteResult<T>>) =>
    unwrap(await run(await mainsOf(mount)))
  return {
    defaults: followed(
      (remote: BotMainsRemote) => remote.watchDefaults(),
      () => mainsOf(mount),
    ),
    bot(botId) {
      let feed = bots.get(botId)
      if (feed === undefined) {
        feed = followed(
          (remote: BotMainsRemote) => remote.watch(botId),
          () => mainsOf(mount),
        )
        bots.set(botId, feed)
      }
      return feed
    },
    setDefaults: (settings) => call((remote) => remote.setDefaults(settings)),
    configure: (botId, override) => call((remote) => remote.configure(botId, override)),
    startNew: (botId) => call((remote) => remote.startNew(botId)),
  }
}
