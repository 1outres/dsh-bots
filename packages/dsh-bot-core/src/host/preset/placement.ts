/**
 * Keep blank bot sessions on their bot's preset.
 *
 * DSH lets a blank session change its Agent preset (the composer's preset
 * picker). In a bot's session that would leave it on a foreign preset, which
 * isolation then locks down. This keeper selects the bot's preset back while
 * the session is still blank. It is a repair, best effort: isolation stays
 * the guarantee, and a session whose first turn already started stays locked
 * down.
 */
import { botPresetId } from "../../shared/preset"

export interface PlacementDeps<A extends object> {
  presetOf(agent: A): string | undefined
  /** The bot the Agent's session belongs to (see isolation's `sessionBotOf`). */
  sessionBotOf(agent: A): string | undefined
  /** Whether the Agent is exempt: a Main session created before bot presets. */
  exempt(agent: A): boolean
  /** Whether the bot's preset is registered (selecting it can succeed). */
  ready(botId: string): boolean
  /** `agentPresets.select(agent, presetId)`; rejects once the session started. */
  select(agent: A, presetId: string): Promise<unknown>
  label(agent: A): string
  warn(message: string): void
}

export function createPlacementKeeper<A extends object>(deps: PlacementDeps<A>) {
  /** Agents with a switch in flight, so repeated events do not stack switches. */
  const switching = new WeakSet<A>()

  return {
    /** The preset `agent` should run, or undefined when it is not a bot's session. */
    wanted(agent: A): string | undefined {
      const botId = deps.sessionBotOf(agent)
      if (botId === undefined || deps.exempt(agent)) return undefined
      return botPresetId(botId)
    },

    /**
     * After an Agent was created or its preset was selected: switch a blank
     * bot session back to that bot's preset.
     */
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
