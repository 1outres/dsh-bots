import { foldName, foldText, originalRange } from "../text-fold"
import type { Conversation, ConversationMessage } from "./history"
import { type Period, withinPeriod } from "./period"

export interface ConversationMatch {
  readonly conversation: Conversation
  readonly message: ConversationMessage
  readonly index: number
  readonly start: number
  readonly end: number
}

export interface SearchOutcome {
  readonly matches: readonly ConversationMatch[]
  readonly total: number
}

export function searchConversations(
  conversations: readonly Conversation[],
  query: string,
  period: Period,
  limit: number,
): SearchOutcome {
  const wanted = foldName(query)
  const found = conversations.flatMap((conversation) =>
    conversation.messages.flatMap((message, index): ConversationMatch[] => {
      if (!withinPeriod(period, message.time)) return []
      const folded = foldText(message.text)
      const at = folded.text.indexOf(wanted)
      if (at < 0) return []
      const range = originalRange(folded, at, at + wanted.length)
      return [{ conversation, message, index, ...range }]
    }),
  )
  const sorted = found.sort(
    (left, right) =>
      right.message.time - left.message.time ||
      left.conversation.sessionId.localeCompare(right.conversation.sessionId) ||
      right.message.seq - left.message.seq,
  )
  return { matches: sorted.slice(0, limit), total: sorted.length }
}
