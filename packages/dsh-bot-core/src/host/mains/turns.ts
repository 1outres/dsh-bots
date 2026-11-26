import type { MainTurnResult } from "../../mains-contract"
import { endedTurnOf, type SessionEventLike, type TurnEndReason } from "../channels/feed"

export interface MaintenanceTurns {
  expect(sessionId: string): Promise<MainTurnResult>
  abandon(sessionId: string, message: string): void
  follow(sessionId: string, event: SessionEventLike): void
  idled(sessionId: string): void
  belongs(sessionId: string, event: SessionEventLike): boolean
}

interface Expected {
  turn: number | undefined
  ended: MainTurnResult | undefined
  idle: boolean
  readonly settle: (result: MainTurnResult) => void
}

function resultOf(reason: TurnEndReason): MainTurnResult {
  const state = endedTurnOf(reason)
  if (state === undefined) return { ended: "failed", message: "the turn was interrupted" }
  switch (state.phase) {
    case "completed":
      return { ended: "completed" }
    case "failed":
      return { ended: "failed", message: state.message }
    case "cancelled":
      return { ended: "cancelled", message: `cancelled by ${state.by}` }
    case "started":
      return { ended: "failed", message: "the turn did not end" }
  }
}

function turnOf(event: SessionEventLike): number | undefined {
  const data = event.data as { readonly turn?: unknown } | null
  return typeof data?.turn === "number" ? data.turn : undefined
}

export function createMaintenanceTurns(): MaintenanceTurns {
  const expected = new Map<string, Expected>()
  const marked = new Map<string, number>()
  const settle = (sessionId: string, entry: Expected, result: MainTurnResult) => {
    expected.delete(sessionId)
    entry.settle(result)
  }
  return {
    expect(sessionId) {
      if (expected.has(sessionId)) {
        throw new Error(`a maintenance turn of "${sessionId}" is still running`)
      }
      return new Promise<MainTurnResult>((resolve) => {
        expected.set(sessionId, { turn: undefined, ended: undefined, idle: false, settle: resolve })
      })
    },
    abandon(sessionId, message) {
      const entry = expected.get(sessionId)
      if (entry === undefined) return
      settle(sessionId, entry, { ended: "failed", message })
    },
    follow(sessionId, event) {
      const entry = expected.get(sessionId)
      if (entry === undefined) return
      const turn = turnOf(event)
      if (turn === undefined) return
      if (event.type === "turn/start") {
        if (entry.turn === undefined) {
          entry.turn = turn
          marked.set(sessionId, turn)
        } else if (entry.ended !== undefined) {
          settle(sessionId, entry, entry.ended)
        }
        return
      }
      if (event.type === "turn/end" && turn === entry.turn) {
        entry.ended = resultOf((event.data as { readonly reason: TurnEndReason }).reason)
        if (entry.idle) settle(sessionId, entry, entry.ended)
      }
    },
    idled(sessionId) {
      const entry = expected.get(sessionId)
      if (entry === undefined || entry.turn === undefined) return
      if (entry.ended !== undefined) settle(sessionId, entry, entry.ended)
      else entry.idle = true
    },
    belongs(sessionId, event) {
      const turn = turnOf(event)
      return turn !== undefined && marked.get(sessionId) === turn
    },
  }
}
