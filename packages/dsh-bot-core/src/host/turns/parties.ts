import type { SessionEventLike } from "../channels/feed"
import { authorshipOf } from "../channels/header"
import { turnBoundaryOf } from "../channels/silence"
import { MAIN_MESSAGE_SOURCE, PEER_RELAY_SOURCE } from "../managed/messages"
import { NOTICE_SOURCES } from "../notices/delivery"

export type TurnParty = "owner" | "other" | "peer" | "system"

export const MAINTENANCE_SOURCE = "bot-main"

export interface TurnInput {
  readonly content: readonly { readonly type: string; readonly text?: string }[]
  readonly source: {
    readonly kind: string
    readonly principal?: unknown
    readonly peerMessages?: unknown
  }
}

const SOURCE_PARTIES: ReadonlyMap<string, TurnParty> = new Map<string, TurnParty>([
  [NOTICE_SOURCES.event, "other"],
  [NOTICE_SOURCES.heartbeat, "other"],
  [NOTICE_SOURCES.peer, "peer"],
  [NOTICE_SOURCES["peer-session"], "peer"],
  [PEER_RELAY_SOURCE, "peer"],
  [NOTICE_SOURCES["peer-status"], "system"],
  [NOTICE_SOURCES.session, "system"],
  [NOTICE_SOURCES.schedule, "system"],
  [NOTICE_SOURCES.connector, "system"],
  [NOTICE_SOURCES.file, "system"],
  [MAINTENANCE_SOURCE, "system"],
  [MAIN_MESSAGE_SOURCE, "system"],
])

export function inputPartyOf(input: TurnInput): TurnParty | undefined {
  const { source } = input
  if (source.kind !== "user") return SOURCE_PARTIES.get(source.kind)
  if (source.principal !== undefined) return "other"
  const first = input.content.find(
    (block) => block.type === "text" && typeof block.text === "string",
  )
  return first?.text === undefined || authorshipOf(first.text).owner ? "owner" : "other"
}

export function peerMessagesOf(input: TurnInput): readonly string[] {
  const { peerMessages } = input.source
  if (!Array.isArray(peerMessages)) return []
  return peerMessages.filter((id): id is string => typeof id === "string" && id !== "")
}

export interface PartyTurn {
  readonly turn: number
  readonly open: boolean
  readonly inputs: readonly TurnParty[]
  readonly peerMessages: readonly string[]
}

export function startedByOf(turn: PartyTurn): TurnParty | undefined {
  return turn.inputs[0]
}

export function tookIn(turn: PartyTurn, party: TurnParty): boolean {
  return turn.inputs.includes(party)
}

export function peerDerived(turn: PartyTurn | undefined): boolean {
  return turn === undefined || tookIn(turn, "peer")
}

export interface TurnParties {
  sessionEvent(sessionId: string, event: SessionEventLike): void
  current(sessionId: string): PartyTurn | undefined
  latest(sessionId: string): PartyTurn | undefined
  forget(sessionId: string): void
}

interface TurnDraft {
  readonly turn: number
  open: boolean
  readonly inputs: TurnParty[]
  readonly peerMessages: string[]
}

const frozen = (draft: TurnDraft): PartyTurn => ({
  turn: draft.turn,
  open: draft.open,
  inputs: [...draft.inputs],
  peerMessages: [...draft.peerMessages],
})

export function createTurnParties(deps: { tracked(sessionId: string): boolean }): TurnParties {
  const turns = new Map<string, TurnDraft>()
  return {
    sessionEvent(sessionId, event) {
      const boundary = turnBoundaryOf(event)
      if (boundary !== undefined) {
        if (boundary.edge === "start") {
          if (deps.tracked(sessionId)) {
            turns.set(sessionId, {
              turn: boundary.turn,
              open: true,
              inputs: [],
              peerMessages: [],
            })
          } else {
            turns.delete(sessionId)
          }
        } else {
          const turn = turns.get(sessionId)
          if (turn?.turn === boundary.turn) turn.open = false
        }
        return
      }
      if (event.type !== "user/message") return
      const turn = turns.get(sessionId)
      if (turn === undefined || !turn.open) return
      const input = event.data as TurnInput
      const party = inputPartyOf(input)
      if (party === undefined) return
      turn.inputs.push(party)
      if (party === "peer") {
        for (const id of peerMessagesOf(input)) {
          if (!turn.peerMessages.includes(id)) turn.peerMessages.push(id)
        }
      }
    },
    current(sessionId) {
      const turn = turns.get(sessionId)
      return turn?.open === true ? frozen(turn) : undefined
    },
    latest(sessionId) {
      const turn = turns.get(sessionId)
      return turn === undefined ? undefined : frozen(turn)
    },
    forget(sessionId) {
      turns.delete(sessionId)
    },
  }
}
