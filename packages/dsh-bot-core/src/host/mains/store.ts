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
  mainSettings: BotTable<StoredMainSettings>
  mainOverrides: BotTable<StoredMainOverride>
  mainActivity: BotTable<MainActivityRecord>
}

export interface MainActivity {
  readonly firstTurnAt?: number
  readonly lastTurnAt?: number
  readonly compactions: number
  readonly idleCompactedFor?: number
}

export const FRESH_ACTIVITY: MainActivity = { compactions: 0 }

export interface MainStore {
  defaults(): MainRotationSettings
  setDefaults(settings: MainRotationSettings): Promise<MainRotationSettings>
  override(botId: string): MainRotationOverride
  setOverride(botId: string, override: MainRotationOverride): Promise<void>
  activity(botId: string, sessionId: string): MainActivity
  updateActivity(
    botId: string,
    sessionId: string,
    change: (current: MainActivity) => MainActivity,
  ): Promise<void>
  purge(keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: (botId: string | undefined) => void): () => void
}

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
