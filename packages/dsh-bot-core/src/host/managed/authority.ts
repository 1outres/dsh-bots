import { type PartyTurn, tookIn } from "../turns/parties"

export const UNSEEN_TURN =
  "Workspace sessions can be used only in a turn bot-core saw start; try again in your next turn"

export const OUTSIDE_TURN =
  "this turn took in a message from someone other than your owner, so Workspace sessions cannot be used in it; your owner can ask you directly"

export const PEER_TURN =
  "this turn took in a message from a peer bot, so Workspace sessions cannot be used in it; your owner can ask you directly"

export function workspaceRefusal(turn: PartyTurn | undefined): string | undefined {
  if (turn === undefined) return UNSEEN_TURN
  if (tookIn(turn, "other")) return OUTSIDE_TURN
  if (tookIn(turn, "peer")) return PEER_TURN
  return undefined
}
