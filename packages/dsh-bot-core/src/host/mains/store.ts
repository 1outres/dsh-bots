import {
  DEFAULT_MAIN_ROTATION,
  type MainRotationOverride,
  type MainRotationSettings,
} from "../../shared/mains"
import type { BotTable } from "../registry"
import {
  MAIN_DEFAULTS_KEY,
  type MainActivityRecord,
  type StoredMainOverride,
  type StoredMainSettings,
} from "./domain"

export interface MainStoreDeps {
  /** The tables of MAINS_DOMAIN; only the store writes them (design rule 50). */
  mainSettings: BotTable<StoredMainSettings>
  mainOverrides: BotTable<StoredMainOverride>
  mainActivity: BotTable<MainActivityRecord>
}

/** The activity of a bot's Main, read for one session: a record of another session reads as fresh. */
export interface MainActivity {
  readonly firstTurnAt?: number
  readonly lastTurnAt?: number
  readonly compactions: number
  readonly idleCompactedFor?: number
}

export const FRESH_ACTIVITY: MainActivity = { compactions: 0 }

/** Settings and Main activity of every bot, as stored. Writes are serialized. */
export interface MainStore {
  defaults(): MainRotationSettings
  setDefaults(settings: MainRotationSettings): Promise<MainRotationSettings>
  override(botId: string): MainRotationOverride
  /** An empty override is deleted. */
  setOverride(botId: string, override: MainRotationOverride): Promise<void>
  activity(botId: string, sessionId: string): MainActivity
  /** Change the activity of `sessionId` (a fresh one when the record describes another session). */
  updateActivity(
    botId: string,
    sessionId: string,
    change: (current: MainActivity) => MainActivity,
  ): Promise<void>
  /** Drop the overrides and activity of bots `keep` refuses. */
  purge(keep: (botId: string) => boolean): Promise<void>
  /** Called with the bot id after its override or activity changed, or with undefined after the defaults did. */
  subscribe(listener: (botId: string | undefined) => void): () => void
}

/**
 * Opens the store; a first start stores {@link DEFAULT_MAIN_ROTATION}, defaults
 * stored before a setting existed get its default value, and only stored values
 * are read after that.
 */
export async function openMainStore(deps: MainStoreDeps): Promise<MainStore> {
  const stored = deps.mainSettings.get(MAIN_DEFAULTS_KEY)
  if (stored === undefined) {
    await deps.mainSettings.put(MAIN_DEFAULTS_KEY, DEFAULT_MAIN_ROTATION)
  } else if (stored.memoryFlush === undefined) {
    await deps.mainSettings.put(MAIN_DEFAULTS_KEY, {
      ...stored,
      memoryFlush: DEFAULT_MAIN_ROTATION.memoryFlush,
    })
  }
  const listeners = new Set<(botId: string | undefined) => void>()
  const publish = (botId: string | undefined) => {
    for (const listener of [...listeners]) listener(botId)
  }
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const activity = (botId: string, sessionId: string): MainActivity => {
    const stored = deps.mainActivity.get(botId)
    if (stored === undefined || stored.sessionId !== sessionId) return FRESH_ACTIVITY
    const { sessionId: _sessionId, ...rest } = stored
    return rest
  }
  return {
    defaults: () => deps.mainSettings.get(MAIN_DEFAULTS_KEY) as MainRotationSettings,
    setDefaults: (settings) =>
      serial(async () => {
        await deps.mainSettings.put(MAIN_DEFAULTS_KEY, settings)
        publish(undefined)
        return settings
      }),
    override: (botId) => deps.mainOverrides.get(botId) ?? {},
    setOverride: (botId, override) =>
      serial(async () => {
        if (Object.keys(override).length === 0) await deps.mainOverrides.delete(botId)
        else await deps.mainOverrides.put(botId, override)
        publish(botId)
      }),
    activity,
    updateActivity: (botId, sessionId, change) =>
      serial(async () => {
        const next = change(activity(botId, sessionId))
        await deps.mainActivity.put(botId, { sessionId, ...next })
        publish(botId)
      }),
    purge: (keep) =>
      serial(async () => {
        for (const [botId] of [...deps.mainOverrides.entries()]) {
          if (!keep(botId)) await deps.mainOverrides.delete(botId)
        }
        for (const [botId] of [...deps.mainActivity.entries()]) {
          if (!keep(botId)) await deps.mainActivity.delete(botId)
        }
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
