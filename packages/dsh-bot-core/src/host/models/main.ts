import type { BotModelChoice, BotModelSelection } from "../../shared/models"
import type { BotModelStore } from "./store"

export interface ModelAgent {
  readonly model: { select(selection: BotModelSelection): void }
}

export interface MainModelDeps {
  readonly store: Pick<BotModelStore, "get" | "has" | "markApplied">
  mainOf(botId: string): string | undefined
  agent(sessionId: string): ModelAgent | undefined
  resolve(choice: BotModelChoice): Promise<BotModelSelection>
  warn(message: string): void
}

export interface MainModelApplier {
  apply(botId: string): Promise<void>
}

export function createMainModelApplier(deps: MainModelDeps): MainModelApplier {
  const chains = new Map<string, Promise<void>>()

  const run = async (botId: string) => {
    if (!deps.store.has(botId)) return
    const stored = deps.store.get(botId)
    if (!stored.mainPending) return
    const sessionId = deps.mainOf(botId)
    const agent = sessionId === undefined ? undefined : deps.agent(sessionId)
    if (agent === undefined) return
    const choice = stored.models.main
    let selection: BotModelSelection
    try {
      selection = await deps.resolve(choice)
    } catch (error) {
      deps.warn(
        `bot-core: the Main session of bot "${botId}" keeps its model; its main model cannot run now and is applied when its Agent is next loaded: ${String(error)}`,
      )
      return
    }
    agent.model.select(selection)
    await deps.store.markApplied(botId, choice)
  }

  return {
    apply(botId) {
      const next = (chains.get(botId) ?? Promise.resolve()).then(() => run(botId))
      const settled = next.catch(() => {})
      chains.set(botId, settled)
      void settled.then(() => {
        if (chains.get(botId) === settled) chains.delete(botId)
      })
      return next
    },
  }
}
