import { createStore, type Observable } from "./observable"

/** Deleting a bot, confirmed by typing its name in a dialog over whatever is open. */
export interface BotDeletion {
  /** The bot whose deletion waits for the user's confirmation. */
  readonly asking: Observable<string | null>
  ask(botId: string): void
  cancel(): void
  /** Delete the asked bot; resolves once the Host took the deletion and the dialog closed. */
  confirm(botId: string): Promise<void>
}

export interface BotDeletionOptions {
  /** Never rejects: a refusal is shown on the bot's row. */
  removeBot(botId: string): Promise<void>
  /** The bot's deletion is under way: close what shows it (its settings). */
  deleted(botId: string): void
}

/** Whether the typed confirmation names the bot. */
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
