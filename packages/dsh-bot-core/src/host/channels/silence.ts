import type { SessionEventLike } from "./feed"

export interface TurnBoundary {
  readonly edge: "start" | "end"
  readonly turn: number
}

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

export interface TurnSilence {
  follow(sessionId: string, boundary: TurnBoundary): void
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
