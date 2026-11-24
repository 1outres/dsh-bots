import type { BotCompactor } from "../../internal"

/** The compactors bots' mounted preset revisions handed over, by bot and revision token. */
export interface CompactorKeeper {
  attach(botId: string, token: string, compactor: BotCompactor): () => void
  get(botId: string, token: string): BotCompactor | undefined
}

export function createCompactorKeeper(): CompactorKeeper {
  const byBot = new Map<string, Map<string, BotCompactor>>()
  return {
    attach(botId, token, compactor) {
      const tokens = byBot.get(botId) ?? new Map<string, BotCompactor>()
      tokens.set(token, compactor)
      byBot.set(botId, tokens)
      return () => {
        if (tokens.get(token) === compactor) tokens.delete(token)
        if (tokens.size === 0 && byBot.get(botId) === tokens) byBot.delete(botId)
      }
    },
    get: (botId, token) => byBot.get(botId)?.get(token),
  }
}
