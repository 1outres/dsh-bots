import type { MainTurnResult } from "../../mains-contract"
import { endedTurnOf, type SessionEventLike, type TurnEndReason } from "../channels/feed"

/**
 * Maintenance turns of Main sessions: the turn a preparation asked for, from
 * its start to its end. Its outputs stay off the channels and its end is not
 * the user's activity.
 */
export interface MaintenanceTurns {
  /**
   * The session's next turn is a maintenance turn; resolves once it ended and
   * the Agent left it (became idle, or started its next turn).
   * @throws while an earlier maintenance turn of the session is still expected.
   */
  expect(sessionId: string): Promise<MainTurnResult>
  /** The expected turn will not come (its prompt was not queued). */
  abandon(sessionId: string, message: string): void
  /** Follow a session's log (before anything asks {@link belongs} about the event). */
  follow(sessionId: string, event: SessionEventLike): void
  /** The session's Agent became idle. */
  idled(sessionId: string): void
  /** Whether the event is part of a maintenance turn of the session. */
  belongs(sessionId: string, event: SessionEventLike): boolean
}

interface Expected {
  turn: number | undefined
  ended: MainTurnResult | undefined
  /** The Agent became idle after the turn started. */
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

/** The turn number a log event carries, if any. */
function turnOf(event: SessionEventLike): number | undefined {
  const data = event.data as { readonly turn?: unknown } | null
  return typeof data?.turn === "number" ? data.turn : undefined
}

export function createMaintenanceTurns(): MaintenanceTurns {
  const expected = new Map<string, Expected>()
  /** The latest maintenance turn of each session, running or ended. */
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
