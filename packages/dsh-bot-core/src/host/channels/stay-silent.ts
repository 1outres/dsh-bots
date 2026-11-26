import type { AssistantBlock } from "./feed"
import type { TurnSilence } from "./silence"

export const STAY_SILENT_TOOL = "stay_silent"

export const silencerCallsOf = (blocks: readonly AssistantBlock[]): readonly string[] =>
  blocks.flatMap((block) =>
    block.type === "tool-call" && block.name === STAY_SILENT_TOOL && block.id !== undefined
      ? [block.id]
      : [],
  )

export interface StaySilentRequest {
  readonly agentId: string
}

export interface StaySilentResult {
  readonly turn: number
}

export interface StaySilentDeps {
  refusal(botId: string, token: string, agentId: string): string | undefined
  silence: Pick<TurnSilence, "silence">
}

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
