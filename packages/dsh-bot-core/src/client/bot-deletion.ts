import { createStore, type Observable } from "./observable"

export interface BotDeletion {
  readonly asking: Observable<string | null>
  ask(botId: string): void
  cancel(): void
  confirm(botId: string): Promise<void>
}

export interface BotDeletionOptions {
  removeBot(botId: string): Promise<void>
  deleted(botId: string): void
}

export const confirmsDeletion = (typed: string, name: string): boolean => typed.trim() === name

export function createBotDeletion(options: BotDeletionOptions): BotDeletion {
  const asking = createStore<string | null>(null)
  return {
    asking,
    ask: (botId) => asking.set(botId),
    cancel: () => asking.set(null),
    async confirm(botId) {
      if (asking.getSnapshot() !== botId) return
      await options.removeBot(botId)
      if (asking.getSnapshot() === botId) asking.set(null)
      options.deleted(botId)
    },
  }
}
