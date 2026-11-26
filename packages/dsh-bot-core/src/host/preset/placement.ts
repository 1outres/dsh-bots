import { botPresetId } from "../../shared/preset"

export interface PlacementDeps<A extends object> {
  presetOf(agent: A): string | undefined
  sessionBotOf(agent: A): string | undefined
  exempt(agent: A): boolean
  ready(botId: string): boolean
  select(agent: A, presetId: string): Promise<unknown>
  label(agent: A): string
  warn(message: string): void
}

export function createPlacementKeeper<A extends object>(deps: PlacementDeps<A>) {
  const switching = new WeakSet<A>()

  return {
    wanted(agent: A): string | undefined {
      const botId = deps.sessionBotOf(agent)
      if (botId === undefined || deps.exempt(agent)) return undefined
      return botPresetId(botId)
    },

    check(agent: A): void {
      const wanted = this.wanted(agent)
      if (wanted === undefined || deps.presetOf(agent) === wanted || switching.has(agent)) return
      const botId = deps.sessionBotOf(agent)
      if (botId === undefined || !deps.ready(botId)) return
      switching.add(agent)
      deps
        .select(agent, wanted)
        .catch((error: unknown) => {
          deps.warn(
            `bot-core: session "${deps.label(agent)}" of bot "${botId}" runs another Agent preset and could not be switched back, so it stays locked down: ${
              error instanceof Error ? error.message : String(error)
            }`,
          )
        })
        .finally(() => {
          switching.delete(agent)
        })
    },
  }
}
