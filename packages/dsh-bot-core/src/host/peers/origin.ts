import { type PartyTurn, peerDerived } from "../turns/parties"
import type { PeerState } from "./store"

export interface PeerOrigin {
  readonly peerMessages: readonly string[]
  readonly from: string | undefined
}

export function peerOriginOf(
  state: PeerState,
  turn: PartyTurn | undefined,
): PeerOrigin | undefined {
  if (!peerDerived(turn)) return undefined
  const peerMessages = turn?.peerMessages ?? []
  const last = peerMessages.at(-1)
  return {
    peerMessages,
    from: last === undefined ? undefined : state.messages.get(last)?.from,
  }
}

export function newThreadDepth(
  state: PeerState,
  origin: PeerOrigin | undefined,
): number | undefined {
  if (origin === undefined) return 0
  if (origin.peerMessages.length === 0) return undefined
  let deepest = 0
  for (const id of origin.peerMessages) {
    const message = state.messages.get(id)
    if (message === undefined) return undefined
    deepest = Math.max(deepest, message.depth)
  }
  return deepest + 1
}
