import type { BotSettingRevertResult, BotSettingsHistoryView } from "../../shared/settings"
import type { Observable } from "../observable"
import type { BotSettingsRemote, RemoteMount } from "../remote"
import { type FeedState, followed, mountedRemote, unwrap } from "../remote-feed"

export interface SettingChangesClient {
  bot(botId: string): Observable<FeedState<BotSettingsHistoryView>>
  revert(botId: string, changeId: string): Promise<BotSettingRevertResult>
}

export function createSettingChangesClient(mount: Promise<RemoteMount>): SettingChangesClient {
  const settingsOf = async (): Promise<BotSettingsRemote> =>
    (await mountedRemote(mount)).botSettings
  const feeds = new Map<string, Observable<FeedState<BotSettingsHistoryView>>>()
  return {
    bot(botId) {
      let feed = feeds.get(botId)
      if (feed === undefined) {
        feed = followed((remote: BotSettingsRemote) => remote.watch(botId), settingsOf)
        feeds.set(botId, feed)
      }
      return feed
    },
    async revert(botId, changeId) {
      return unwrap(await (await settingsOf()).revert(botId, changeId))
    },
  }
}
