import { createStore, type Observable } from "./observable"

/** Per-bot transient state: the last failure. */
export interface BotStatus {
  readonly error?: string
}

export interface StatusStore extends Observable<Readonly<Record<string, BotStatus>>> {
  set(botId: string, status: BotStatus | undefined): void
  get(botId: string): BotStatus | undefined
}

export function createStatusStore(): StatusStore {
  const state = createStore<Readonly<Record<string, BotStatus>>>({})
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    get: (botId) => state.getSnapshot()[botId],
    set(botId, status) {
      state.update((current) => {
        const { [botId]: _previous, ...rest } = current
        return status === undefined ? rest : { ...rest, [botId]: status }
      })
    },
  }
}
