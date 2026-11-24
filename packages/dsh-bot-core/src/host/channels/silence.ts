import type { SessionEventLike } from "./feed"

/** A session's turn starting or ending, as its log tells. */
export interface TurnBoundary {
  readonly edge: "start" | "end"
  readonly turn: number
}

/** The turn boundary a session log event marks, if any. */
export function turnBoundaryOf(event: SessionEventLike): TurnBoundary | undefined {
  switch (event.type) {
    case "turn/start":
      return { edge: "start", turn: (event.data as { readonly turn: number }).turn }
    case "turn/end":
      return { edge: "end", turn: (event.data as { readonly turn: number }).turn }
    default:
      return undefined
  }
}

/**
 * Which sessions' running turns keep their replies off the channels
 * (`stay_silent`). A turn starts not silent; its end forgets it.
 */
export interface TurnSilence {
  follow(sessionId: string, boundary: TurnBoundary): void
  /** Silences the session's running turn: its number, or undefined when none runs. */
  silence(sessionId: string): number | undefined
  isSilent(sessionId: string): boolean
}

export function createTurnSilence(): TurnSilence {
  const running = new Map<string, { readonly turn: number; silent: boolean }>()
  return {
    follow(sessionId, boundary) {
      if (boundary.edge === "start") {
        running.set(sessionId, { turn: boundary.turn, silent: false })
      } else if (running.get(sessionId)?.turn === boundary.turn) {
        running.delete(sessionId)
      }
    },
    silence(sessionId) {
      const current = running.get(sessionId)
      if (current === undefined) return undefined
      current.silent = true
      return current.turn
    },
    isSilent: (sessionId) => running.get(sessionId)?.silent === true,
  }
}
