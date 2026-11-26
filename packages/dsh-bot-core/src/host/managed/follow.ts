import type { BotInteraction } from "../../shared/interactions"
import type { BotManagedSession } from "../../shared/managed-sessions"
import { endedTurnOf, type SessionEventLike, type TurnEndReason } from "../channels/feed"
import type { PeerNoticeOrigin } from "../notices/outbox"
import type { SessionNoticeEvent } from "./notice"

export interface ManagedFollowDeps {
  managed(sessionId: string): BotManagedSession | undefined
  peerOrigin(sessionId: string): PeerNoticeOrigin | undefined
  tell(
    session: BotManagedSession,
    event: SessionNoticeEvent,
    origin: PeerNoticeOrigin | undefined,
  ): void
}

export interface ManagedFollow {
  sessionEvent(sessionId: string, event: SessionEventLike): void
  opened(sessionId: string, interaction: BotInteraction): void
  stopping(sessionId: string): void
}

export function createManagedFollow(deps: ManagedFollowDeps): ManagedFollow {
  const stopped = new Set<string>()
  const originOf = (session: BotManagedSession) =>
    session.target.kind === "bot" ? deps.peerOrigin(session.sessionId) : undefined
  return {
    sessionEvent(sessionId, event) {
      if (event.type !== "turn/end") return
      const ownStop = stopped.delete(sessionId)
      const session = deps.managed(sessionId)
      if (session === undefined) return
      const turn = endedTurnOf((event.data as { readonly reason: TurnEndReason }).reason)
      if (turn === undefined || turn.phase === "started") return
      if (turn.phase === "cancelled" && ownStop) return
      deps.tell(session, { kind: "turn", turn }, originOf(session))
    },
    opened(sessionId, interaction) {
      if (interaction.kind === "approval") return
      const session = deps.managed(sessionId)
      if (session === undefined) return
      deps.tell(
        session,
        {
          kind: "waiting",
          interaction: interaction.kind,
          answerer: session.answerer,
        },
        originOf(session),
      )
    },
    stopping(sessionId) {
      stopped.add(sessionId)
    },
  }
}
