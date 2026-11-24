/**
 * Applies a bot's `main` role to its live Main session. A change that names
 * `main` is stored as pending; it is recorded on the Main (`agent.model.select`,
 * as DSH's model picker does) once its Agent is loaded: at once when it is
 * live, else when it is next created or resumed. It is applied once, so a
 * model picked for the Main in DSH's own picker afterwards stays.
 */
import type { BotModelChoice, BotModelSelection } from "../../shared/models"
import type { BotModelStore } from "./store"

/** The slice of a live Agent the applier records the model on. */
export interface ModelAgent {
  readonly model: { select(selection: BotModelSelection): void }
}

export interface MainModelDeps {
  readonly store: Pick<BotModelStore, "get" | "has" | "markApplied">
  /** The bot's Main session id, once it has one. */
  mainOf(botId: string): string | undefined
  /** The live Agent of a session, if loaded. */
  agent(sessionId: string): ModelAgent | undefined
  /** The route a choice names now, checked (throws when DSH cannot run it). */
  resolve(choice: BotModelChoice): Promise<BotModelSelection>
  warn(message: string): void
}

export interface MainModelApplier {
  /** Record the pending `main` on the bot's Main if it is live. */
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
