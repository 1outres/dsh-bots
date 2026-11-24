import type { BotTurnState } from "../../channel-contract"
import type { BotInteractionKind } from "../../shared/interactions"
import type { BotManagedAnswerer, BotManagedSession } from "../../shared/managed-sessions"

/** Why a management ended without the Main session's own session_release. */
export type ManagedEnding = "owner" | "archive" | "revoked" | "workspace-removed"

/** What happened in a managed session that its bot's Main session hears of. */
export type SessionNoticeEvent =
  | { readonly kind: "turn"; readonly turn: Exclude<BotTurnState, { readonly phase: "started" }> }
  | {
      readonly kind: "waiting"
      readonly interaction: BotInteractionKind
      readonly answerer: BotManagedAnswerer
    }
  | { readonly kind: "released"; readonly by: ManagedEnding }

/** A notice for the bot's Main session (the notice outbox's topic `session`). */
export interface SessionNotice {
  readonly text: string
  readonly summary: string
}

const SUMMARY_MAX = 120

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

function subject(session: BotManagedSession): string {
  const where =
    session.target.kind === "workspace" ? `, Workspace ${session.target.workspaceId}` : ""
  return session.label === undefined
    ? `(${session.sessionId}${where})`
    : `"${oneLine(session.label)}" (${session.sessionId}${where})`
}

const WAITING_FOR: { readonly [Kind in BotInteractionKind]: string } = {
  question: "an answer to a question",
  "plan-review": "a plan review",
  approval: "an approval",
}

function ended(turn: Extract<SessionNoticeEvent, { readonly kind: "turn" }>["turn"]): string {
  switch (turn.phase) {
    case "completed":
      return "turn completed. Read it with session_read."
    case "failed":
      return `turn failed: ${oneLine(turn.message)}. Read it with session_read.`
    case "cancelled":
      return "turn cancelled."
  }
}

const RELEASED: { readonly [By in ManagedEnding]: string } = {
  owner: "your owner took this session back; you no longer manage it.",
  archive: "archived by your owner; you no longer manage it.",
  revoked: "your owner withdrew your access to its Workspace; you no longer manage it.",
  "workspace-removed": "its Workspace was removed from DSH; you no longer manage it.",
}

function what(event: SessionNoticeEvent): string {
  switch (event.kind) {
    case "turn":
      return ended(event.turn)
    case "waiting":
      return event.answerer === "main" && event.interaction !== "approval"
        ? `waiting for ${WAITING_FOR[event.interaction]}; you answer it with session_answer (see session_read).`
        : `waiting for ${WAITING_FOR[event.interaction]}; your owner answers it in the Web UI.`
    case "released":
      return RELEASED[event.by]
  }
}

export function sessionNotice(
  session: BotManagedSession,
  event: SessionNoticeEvent,
): SessionNotice {
  const line = `${subject(session)} — ${what(event)}`
  const summary = line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line
  return { text: `[session] ${line}`, summary }
}
