import type { MainPreparation, MainTurnResult } from "../../mains-contract"
import { memoryFlushPrompt } from "./texts"

export const MEMORY_FLUSH_ID = "bot-core/memory-flush"

export const MEMORY_FLUSH_ORDER = 0

export interface MemoryFlushDeps {
  enabled(botId: string): boolean
}

function within(turn: Promise<MainTurnResult>, signal: AbortSignal): Promise<MainTurnResult> {
  if (signal.aborted) return Promise.reject(new Error("the time for the maintenance ran out"))
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("the memory write-out turn did not end in time"))
    signal.addEventListener("abort", abort, { once: true })
    turn.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

export function createMemoryFlush(deps: MemoryFlushDeps): MainPreparation {
  return {
    id: MEMORY_FLUSH_ID,
    order: MEMORY_FLUSH_ORDER,
    async prepare(request) {
      if (!deps.enabled(request.bot.id)) return
      const result = await within(
        request.runTurn(memoryFlushPrompt(request.maintenance)),
        request.signal,
      )
      if (result.ended !== "completed") {
        throw new Error(`the memory write-out turn ${result.ended}: ${result.message}`)
      }
    },
  }
}
