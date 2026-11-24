import type { TurnSilence } from "./silence"

/** One `stay_silent` call, as the bot's channel row hands it over. */
export interface StaySilentRequest {
  /** The calling Agent (its session id). */
  readonly agentId: string
}

export interface StaySilentResult {
  /** The Main session's turn whose remaining replies stay off the channels. */
  readonly turn: number
}

export interface StaySilentDeps {
  /**
   * Why the call may not silence, or undefined: `token` must be the bot's
   * registered preset revision's, and the Agent the bot's Main session's.
   */
  refusal(botId: string, token: string, agentId: string): string | undefined
  silence: Pick<TurnSilence, "silence">
}

/** The `stay_silent` tool's work: the rest of the Main session's running turn stays off the bot's channels. */
export function createSilencer(deps: StaySilentDeps): {
  staySilent(botId: string, token: string, request: StaySilentRequest): StaySilentResult
} {
  return {
    staySilent(botId, token, request) {
      const refusal = deps.refusal(botId, token, request.agentId)
      if (refusal !== undefined) throw new Error(refusal)
      const turn = deps.silence.silence(request.agentId)
      if (turn === undefined) throw new Error("no turn of the bot's Main session is running")
      return { turn }
    },
  }
}
