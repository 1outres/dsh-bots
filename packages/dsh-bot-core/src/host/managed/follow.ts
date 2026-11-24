import type { BotInteraction } from "../../shared/interactions"
import type { BotManagedSession } from "../../shared/managed-sessions"
import { endedTurnOf, type SessionEventLike, type TurnEndReason } from "../channels/feed"
import type { SessionNoticeEvent } from "./notice"

export interface ManagedFollowDeps {
  /** The managed session, if `sessionId` is one. */
  managed(sessionId: string): BotManagedSession | undefined
  /** Store a notice of the session for its bot's Main session. */
  tell(session: BotManagedSession, event: SessionNoticeEvent): void
}

/**
 * Turns what happens in managed sessions into notices for their bots' Main
 * sessions (docs/specs/bot-managed-sessions.md §7): every live turn end
 * except one the Main session stopped itself, and every question or plan
 * review that opens.
 */
export interface ManagedFollow {
  /** A session's log event (`session/event`). */
  sessionEvent(sessionId: string, event: SessionEventLike): void
  /** An interaction opened on the board in a session. */
  opened(sessionId: string, interaction: BotInteraction): void
  /** The Main session stops the session's running turn: its end is not told. */
  stopping(sessionId: string): void
}

export function createManagedFollow(deps: ManagedFollowDeps): ManagedFollow {
  const stopped = new Set<string>()
  return {
    sessionEvent(sessionId, event) {
      if (event.type !== "turn/end") return
      const ownStop = stopped.delete(sessionId)
      const session = deps.managed(sessionId)
      if (session === undefined) return
      const turn = endedTurnOf((event.data as { readonly reason: TurnEndReason }).reason)
      if (turn === undefined || turn.phase === "started") return
      if (turn.phase === "cancelled" && ownStop) return
      deps.tell(session, { kind: "turn", turn })
    },
    opened(sessionId, interaction) {
      if (interaction.kind === "approval") return
      const session = deps.managed(sessionId)
      if (session === undefined) return
      deps.tell(session, {
        kind: "waiting",
        interaction: interaction.kind,
        answerer: session.answerer,
      })
    },
    stopping(sessionId) {
      stopped.add(sessionId)
    },
  }
}
