import type { VaultGrantAvailability } from "../../shared/vaults"

/** What bot-core last learned of whether each login's item can be read (in memory). */
export interface VaultAvailability {
  get(botId: string, grantId: string): VaultGrantAvailability
  set(botId: string, grantId: string, state: Exclude<VaultGrantAvailability, "unchecked">): void
  subscribe(listener: (botId: string) => void): () => void
}

export function createVaultAvailability(): VaultAvailability {
  const states = new Map<string, Exclude<VaultGrantAvailability, "unchecked">>()
  const listeners = new Set<(botId: string) => void>()
  const keyOf = (botId: string, grantId: string) => `${botId}:${grantId}`
  return {
    get: (botId, grantId) => states.get(keyOf(botId, grantId)) ?? "unchecked",
    set(botId, grantId, state) {
      const key = keyOf(botId, grantId)
      if (states.get(key) === state) return
      states.set(key, state)
      for (const listener of [...listeners]) listener(botId)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
