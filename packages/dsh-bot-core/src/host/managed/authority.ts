import type { SessionEventLike } from "../channels/feed"
import { authorshipOf } from "../channels/header"
import { turnBoundaryOf } from "../channels/silence"

export interface TurnInput {
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly source: { readonly kind: string; readonly principal?: unknown }
}

const OUTSIDE_SOURCES: readonly string[] = ["bot-connector-event"]

export function fromOwnerSide(input: TurnInput): boolean {
  const { source } = input
  if (OUTSIDE_SOURCES.includes(source.kind)) return false
  if (source.kind !== "user") return true
  if (source.principal !== undefined) return false
  const first = input.content.find(
    (block) => block.type === "text" && typeof block.text === "string",
  )
  return first?.text === undefined || authorshipOf(first.text).owner
}

export interface TurnAuthority {
  sessionEvent(sessionId: string, event: SessionEventLike): void
  refusal(sessionId: string): string | undefined
}

export function createTurnAuthority(deps: { isMain(sessionId: string): boolean }): TurnAuthority {
  const turns = new Map<string, { readonly turn: number; outside: boolean }>()
  return {
    sessionEvent(sessionId, event) {
      const boundary = turnBoundaryOf(event)
      if (boundary !== undefined) {
        if (boundary.edge === "start") {
          if (deps.isMain(sessionId)) turns.set(sessionId, { turn: boundary.turn, outside: false })
        } else if (turns.get(sessionId)?.turn === boundary.turn) {
          turns.delete(sessionId)
        }
        return
      }
      if (event.type !== "user/message") return
      const turn = turns.get(sessionId)
      if (turn !== undefined && !fromOwnerSide(event.data as TurnInput)) turn.outside = true
    },
    refusal(sessionId) {
      const turn = turns.get(sessionId)
      if (turn === undefined) {
        return "Workspace sessions can be used only in a turn bot-core saw start; try again in your next turn"
      }
      return turn.outside
        ? "this turn took in a message from someone other than your owner, so Workspace sessions cannot be used in it; your owner can ask you directly"
        : undefined
    },
  }
}
