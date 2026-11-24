/**
 * The state of a bot's Skills pages, apart from React: a skill's history
 * (read again whenever the bot's skills change) and one version with what it
 * changed against the version before it.
 */
import type { BotSkillHistory, BotSkillsView, SkillVersion } from "../../shared/skills"
import { createStore, type Observable } from "../observable"
import { type FeedState, messageOf } from "../remote-feed"
import type { SkillsClient } from "./client"
import { type FileChange, fileChanges } from "./diff"

/** A load that runs while subscribed and again whenever `trigger` changes. */
function loaded<T>(
  load: () => Promise<T>,
  trigger: Observable<FeedState<BotSkillsView>>,
): Observable<FeedState<T>> {
  const state = createStore<FeedState<T>>({ status: "loading" })
  let generation = 0
  const run = () => {
    const current = ++generation
    load().then(
      (value) => {
        if (current === generation) state.set({ status: "ready", value })
      },
      (error: unknown) => {
        if (current === generation) state.set({ status: "failed", message: messageOf(error) })
      },
    )
  }
  let followers = 0
  let off: (() => void) | undefined
  return {
    getSnapshot: state.getSnapshot,
    subscribe(listener) {
      const stop = state.subscribe(listener)
      followers += 1
      if (followers === 1) {
        let last = trigger.getSnapshot()
        off = trigger.subscribe(() => {
          const next = trigger.getSnapshot()
          if (next !== last && next.status === "ready") run()
          last = next
        })
        run()
      }
      return () => {
        stop()
        followers -= 1
        if (followers === 0) {
          generation += 1
          off?.()
          off = undefined
        }
      }
    },
  }
}

/** A skill's history, kept current while shown. */
export function skillHistory(
  client: SkillsClient,
  botId: string,
  name: string,
): Observable<FeedState<BotSkillHistory>> {
  return loaded(() => client.history(botId, name), client.bot(botId))
}

/** One version and its changes against the version before it (every file added for the first). */
export interface VersionView {
  readonly version: SkillVersion
  readonly previous: string | undefined
  readonly changes: readonly FileChange[]
  /** It is the newest version: putting it back would change nothing. */
  readonly newest: boolean
}

export function skillVersion(
  client: SkillsClient,
  botId: string,
  name: string,
  versionId: string,
): Observable<FeedState<VersionView>> {
  return loaded(async () => {
    const history = await client.history(botId, name)
    const index = history.versions.findIndex((item) => item.id === versionId)
    if (index < 0) throw new Error(`version ${versionId} is no longer kept`)
    const older = history.versions[index + 1]
    const [version, previous] = await Promise.all([
      client.version(botId, name, versionId),
      older === undefined ? Promise.resolve(undefined) : client.version(botId, name, older.id),
    ])
    return {
      version,
      previous: previous?.id,
      changes: fileChanges(previous?.files ?? [], version.files),
      newest: index === 0,
    }
  }, client.bot(botId))
}

/** What the version page shows: what changed, or the whole content. */
export type VersionTab = "changes" | "content"

export function createVersionTab() {
  return createStore<VersionTab>("changes")
}
