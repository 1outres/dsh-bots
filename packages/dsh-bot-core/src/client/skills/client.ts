import type { BotSkillHistory, BotSkillsView, SkillVersion } from "../../shared/skills"
import type { Observable } from "../observable"
import type { BotSkillsRemote, RemoteMount } from "../remote"
import { type FeedState, followed, mountedRemote, unwrap } from "../remote-feed"
import type { RemoteResult } from "../types"

export interface SkillsClient {
  bot(botId: string): Observable<FeedState<BotSkillsView>>
  history(botId: string, name: string): Promise<BotSkillHistory>
  version(botId: string, name: string, versionId: string): Promise<SkillVersion>
  restoreVersion(botId: string, name: string, versionId: string): Promise<BotSkillHistory>
  restoreArchived(botId: string, name: string): Promise<BotSkillHistory>
  setReview(botId: string, enabled: boolean): Promise<BotSkillsView>
  setCurator(botId: string, enabled: boolean): Promise<BotSkillsView>
  setKeep(botId: string, name: string, keep: boolean): Promise<BotSkillsView>
}

export function createSkillsClient(mount: Promise<RemoteMount>): SkillsClient {
  const skillsOf = async (): Promise<BotSkillsRemote> => (await mountedRemote(mount)).botSkills
  const feeds = new Map<string, Observable<FeedState<BotSkillsView>>>()
  const call = async <T>(run: (remote: BotSkillsRemote) => Promise<RemoteResult<T>>) =>
    unwrap(await run(await skillsOf()))
  return {
    bot(botId) {
      let feed = feeds.get(botId)
      if (feed === undefined) {
        feed = followed((remote: BotSkillsRemote) => remote.watch(botId), skillsOf)
        feeds.set(botId, feed)
      }
      return feed
    },
    history: (botId, name) => call((remote) => remote.history(botId, name)),
    version: (botId, name, versionId) => call((remote) => remote.version(botId, name, versionId)),
    restoreVersion: (botId, name, versionId) =>
      call((remote) => remote.restoreVersion(botId, name, versionId)),
    restoreArchived: (botId, name) => call((remote) => remote.restoreArchived(botId, name)),
    setReview: (botId, enabled) => call((remote) => remote.setReview(botId, enabled)),
    setCurator: (botId, enabled) => call((remote) => remote.setCurator(botId, enabled)),
    setKeep: (botId, name, keep) => call((remote) => remote.setKeep(botId, name, keep)),
  }
}
