import type { BotGroupPause } from "../../shared/peers"
import type { PeerMessageRecord } from "./domain"

const MINUTE_MS = 60_000

export const PEER_LIMITS = {
  messageLength: 4_000,
  thread: 12,
  pair: { count: 8, windowMs: 10 * MINUTE_MS, pauseMs: 30 * MINUTE_MS },
  group: { count: 30, windowMs: 10 * MINUTE_MS },
  sender: { count: 40, windowMs: 60 * MINUTE_MS },
  maxDepth: 1,
  deliveryMs: 24 * 60 * MINUTE_MS,
} as const

export interface PeerSendRequest {
  readonly groupId: string
  readonly from: string
  readonly to: string
  readonly threadId: string
  readonly replying: boolean
  readonly depth: number | undefined
  readonly groupPause: BotGroupPause | undefined
  readonly pairPausedUntil: number | undefined
}

export type PeerRefusalReason =
  | { readonly refusal: "paused"; readonly pause: BotGroupPause }
  | {
      readonly refusal: "pair"
      readonly until: number
      readonly starts: boolean
      readonly count: number
    }
  | { readonly refusal: "group"; readonly count: number }
  | { readonly refusal: "thread"; readonly count: number }
  | { readonly refusal: "sender"; readonly count: number; readonly until: number }
  | { readonly refusal: "depth"; readonly depth: number | undefined }

export type PeerVerdict =
  | { readonly kind: "send" }
  | { readonly kind: "refused"; readonly reason: PeerRefusalReason }

const refused = (reason: PeerRefusalReason): PeerVerdict => ({ kind: "refused", reason })

const counted = (message: PeerMessageRecord) => message.state !== "refused"

const within = (now: number, windowMs: number) => (message: PeerMessageRecord) =>
  message.sentAt > now - windowMs

export function judgePeerSend(
  history: Iterable<PeerMessageRecord>,
  now: number,
  request: PeerSendRequest,
): PeerVerdict {
  if (request.groupPause !== undefined) {
    return refused({ refusal: "paused", pause: request.groupPause })
  }
  const sent = [...history].filter(counted)
  const pair = sent.filter(
    (message) =>
      message.groupId === request.groupId &&
      ((message.from === request.from && message.to === request.to) ||
        (message.from === request.to && message.to === request.from)),
  )
  const pairRecent = pair.filter(within(now, PEER_LIMITS.pair.windowMs))
  if (request.pairPausedUntil !== undefined && request.pairPausedUntil > now) {
    return refused({
      refusal: "pair",
      until: request.pairPausedUntil,
      starts: false,
      count: pairRecent.length,
    })
  }
  if (!request.replying && (request.depth === undefined || request.depth > PEER_LIMITS.maxDepth)) {
    return refused({ refusal: "depth", depth: request.depth })
  }
  const thread = sent.filter((message) => message.threadId === request.threadId).length
  if (request.replying && thread >= PEER_LIMITS.thread) {
    return refused({ refusal: "thread", count: thread })
  }
  const senderRecent = sent
    .filter((message) => message.from === request.from)
    .filter(within(now, PEER_LIMITS.sender.windowMs))
  if (senderRecent.length >= PEER_LIMITS.sender.count) {
    const oldest = Math.min(...senderRecent.map((message) => message.sentAt))
    return refused({
      refusal: "sender",
      count: senderRecent.length,
      until: oldest + PEER_LIMITS.sender.windowMs,
    })
  }
  if (pairRecent.length >= PEER_LIMITS.pair.count) {
    return refused({
      refusal: "pair",
      until: now + PEER_LIMITS.pair.pauseMs,
      starts: true,
      count: pairRecent.length,
    })
  }
  const groupRecent = sent
    .filter((message) => message.groupId === request.groupId)
    .filter(within(now, PEER_LIMITS.group.windowMs))
  if (groupRecent.length >= PEER_LIMITS.group.count) {
    return refused({ refusal: "group", count: groupRecent.length })
  }
  return { kind: "send" }
}
