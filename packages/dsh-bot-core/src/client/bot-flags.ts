import type { Observable } from "./observable"
import { createPersistentValue } from "./persistent-value"

/** One yes/no choice per bot id. */
export type BotFlags = Readonly<Record<string, boolean>>

export interface BotFlagStore extends Observable<BotFlags> {
  set(botId: string, on: boolean): void
}

export function parseBotFlags(stored: unknown): BotFlags {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
    throw new Error("expected an object of bot ids")
  }
  const entries = Object.entries(stored)
  for (const [botId, on] of entries) {
    if (typeof on !== "boolean") throw new Error(`the value of ${botId} is not a boolean`)
  }
  return Object.fromEntries(entries)
}

/** Per-bot choices of the Bots section, persisted in localStorage under `key`. */
export function createBotFlagStore(key: string): BotFlagStore {
  const flags = createPersistentValue<BotFlags>({ key, parse: parseBotFlags, initial: {} })
  return {
    getSnapshot: flags.getSnapshot,
    subscribe: flags.subscribe,
    set(botId, on) {
      const current = flags.getSnapshot()
      if (current[botId] === on) return
      flags.set({ ...current, [botId]: on })
    },
  }
}
