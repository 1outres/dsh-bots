/**
 * Finding a text in what was said (docs/specs/bot-session-search.md §3): NFKC
 * and lower case, as a substring of a message's text (not of the tools it
 * named), newest first.
 */
import { foldName, foldText, originalRange } from "../text-fold"
import type { Conversation, ConversationMessage } from "./history"
import { type Period, withinPeriod } from "./period"

export interface ConversationMatch {
  readonly conversation: Conversation
  readonly message: ConversationMessage
  /** The message's index in the conversation. */
  readonly index: number
  /** Where the text was found in the message's text (code units). */
  readonly start: number
  readonly end: number
}

export interface SearchOutcome {
  /** The newest `limit` matching messages, newest first. */
  readonly matches: readonly ConversationMatch[]
  /** Every matching message. */
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
