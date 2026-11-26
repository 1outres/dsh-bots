import type { SessionEventLike } from "../channels/feed"
import { authorshipOf } from "../channels/header"
import { turnBoundaryOf } from "../channels/silence"
import type { TurnInput } from "../managed/authority"
import { MAIN_MESSAGE_SOURCE } from "../managed/messages"
import { NOTICE_SOURCES } from "../notices/delivery"

export const MAINTENANCE_SOURCE = "bot-main"

export const OUTSIDE_INPUTS: readonly string[] = [
  ...Object.values(NOTICE_SOURCES),
  MAINTENANCE_SOURCE,
  MAIN_MESSAGE_SOURCE,
]

export type TurnParty = "owner" | "other"

export interface SettingsTurn {
  readonly startedBy: TurnParty
  readonly mixed: boolean
}

export function partyOf(input: TurnInput): TurnParty | undefined {
  const { source } = input
  if (source.kind === "user") {
    if (source.principal !== undefined) return "other"
    const first = input.content.find(
      (block) => block.type === "text" && typeof block.text === "string",
    )
    return first?.text === undefined || authorshipOf(first.text).owner ? "owner" : "other"
  }
  return OUTSIDE_INPUTS.includes(source.kind) ? "other" : undefined
}

export interface SettingsTurns {
  sessionEvent(sessionId: string, event: SessionEventLike): void
  of(sessionId: string): SettingsTurn | undefined
}

interface OpenTurn {
  readonly turn: number
  startedBy: TurnParty | undefined
  mixed: boolean
}

export function createSettingsTurns(deps: { tracked(sessionId: string): boolean }): SettingsTurns {
  const turns = new Map<string, OpenTurn>()
  return {
    sessionEvent(sessionId, event) {
      const boundary = turnBoundaryOf(event)
      if (boundary !== undefined) {
        if (boundary.edge === "start") {
          if (deps.tracked(sessionId)) {
            turns.set(sessionId, { turn: boundary.turn, startedBy: undefined, mixed: false })
          }
        } else if (turns.get(sessionId)?.turn === boundary.turn) {
          turns.delete(sessionId)
        }
        return
      }
      if (event.type !== "user/message") return
      const turn = turns.get(sessionId)
      if (turn === undefined) return
      const party = partyOf(event.data as TurnInput)
      if (party === undefined) return
      if (turn.startedBy === undefined) turn.startedBy = party
      else if (party === "other") turn.mixed = true
    },
    of(sessionId) {
      const turn = turns.get(sessionId)
      return turn?.startedBy === undefined
        ? undefined
        : { startedBy: turn.startedBy, mixed: turn.mixed }
    },
  }
}
