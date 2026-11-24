import type { SessionEventLike } from "../channels/feed"
import { authorshipOf } from "../channels/header"
import { turnBoundaryOf } from "../channels/silence"

/** A message a Main session's turn takes in, as far as read here (dsh-llm `UserMessage`). */
export interface TurnInput {
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly source: { readonly kind: string; readonly principal?: unknown }
}

/** Message sources whose text comes from outside: connectors' events (mails, calendar changes). */
const OUTSIDE_SOURCES: readonly string[] = ["bot-connector-event"]

/**
 * Whether the bot's owner (or bot-core itself) is behind a message: not a
 * channel message of someone the channel's owners do not list, not a prompt
 * of a DSH peer other than the owner (`principal`), not a connector's event.
 */
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

/**
 * Who a Main session's running turn listens to (docs/specs/bot-managed-sessions.md
 * §10.8): a turn whose inputs all came from the owner's side may operate
 * Workspaces; once a message of anyone else enters it, it may not until it ends.
 * Only turns seen starting are known; any other (bot-core loaded mid-turn) is refused.
 */
export interface TurnAuthority {
  sessionEvent(sessionId: string, event: SessionEventLike): void
  /** Why the session's running turn may not operate Workspaces, or undefined when it may. */
  refusal(sessionId: string): string | undefined
}

export function createTurnAuthority(deps: {
  /** Whether the session is a bot's Main session. */
  isMain(sessionId: string): boolean
}): TurnAuthority {
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
