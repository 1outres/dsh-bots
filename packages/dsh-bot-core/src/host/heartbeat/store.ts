import { DEFAULT_HEARTBEAT, type HeartbeatSettings } from "../../shared/heartbeat"
import type { BotTable } from "../registry"
import type { HeartbeatSettingsRecord } from "./domain"

export interface HeartbeatStoreDeps {
  readonly heartbeatSettings: BotTable<HeartbeatSettingsRecord>
}

export interface HeartbeatStore {
  get(botId: string): HeartbeatSettings
  set(botId: string, settings: HeartbeatSettings): Promise<void>
  purge(keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: (botId: string) => void): () => void
}

export function createHeartbeatStore(deps: HeartbeatStoreDeps): HeartbeatStore {
  const { heartbeatSettings } = deps
  const listeners = new Set<(botId: string) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const changed = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  return {
    get: (botId) => heartbeatSettings.get(botId) ?? DEFAULT_HEARTBEAT,
    set: (botId, settings) =>
      serial(async () => {
        await heartbeatSettings.put(botId, {
          enabled: settings.enabled,
          intervalMinutes: settings.intervalMinutes,
          ...(settings.activeHours === undefined
            ? {}
            : {
                activeHours: { start: settings.activeHours.start, end: settings.activeHours.end },
              }),
        })
        changed(botId)
      }),
    purge: (keep) =>
      serial(async () => {
        for (const [botId] of [...heartbeatSettings.entries()]) {
          if (keep(botId)) continue
          await heartbeatSettings.delete(botId)
          changed(botId)
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
