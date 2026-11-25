import type { VaultProviderStatus, VaultProviderStatusSource } from "@1outres/dsh-bot-core"

/** The provider's status as state: read, watched, and set by the installer alone. */
export interface StatusCell extends VaultProviderStatusSource {
  set(status: VaultProviderStatus): void
}

export function createStatusCell(initial: VaultProviderStatus): StatusCell {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    read: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set(status) {
      current = status
      for (const listener of [...listeners]) listener()
    },
  }
}
