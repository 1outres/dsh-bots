/**
 * How found conversations read (docs/specs/bot-session-search.md §3, §4):
 * each conversation under a heading with its kind, title, span and session id,
 * each message under a line with its number, time and speaker, cut to size.
 */
import { counted } from "../plural"
import { spokenLines } from "../spoken-messages"
import type { Conversation, ConversationMessage } from "./history"
import type { ConversationMatch, SearchOutcome } from "./search"
import type { ConversationKind } from "./sources"
import { RECORD_NOTE } from "./texts"

/** Bounds of what one result shows, in code points. */
export const RESULT_BOUNDS = {
  match: 400,
  beforeMatch: 120,
  neighbor: 200,
  read: 2000,
} as const

const KINDS: Readonly<Record<ConversationKind, string>> = {
  current: "This conversation, before it was compacted",
  main: "Your Main session",
  "former-main": "Your former Main session",
  web: "A session your owner opened in the Web UI",
}

const SPEAKERS = { person: "user", bot: "you" } as const

const EARLIER = { one: "earlier message", other: "earlier messages" } as const
const LATER = { one: "later message", other: "later messages" } as const

const ELLIPSIS = "…"

/** At most `max` code points of `text` from `from`, marking what was cut. */
function window(text: string, from: number, max: number): string {
  const points = [...text]
  const start = Math.max(0, Math.min(from, points.length - max))
  const end = Math.min(points.length, start + max)
  return [
    start > 0 ? ELLIPSIS : "",
    points.slice(start, end).join(""),
    end < points.length ? ELLIPSIS : "",
  ].join("")
}

export const clipped = (text: string, max: number) => window(text, 0, max)

/** "YYYY-MM-DD HH:MM" in the time zone. */
export function formatTime(at: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value as string
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`
}

function heading(conversation: Conversation, timezone: string): string {
  const first = conversation.messages[0]
  const last = conversation.messages.at(-1)
  const span =
    first === undefined || last === undefined
      ? ""
      : ` · ${formatTime(first.time, timezone)} – ${formatTime(last.time, timezone)}`
  const title = conversation.title === undefined ? "" : `: ${JSON.stringify(conversation.title)}`
  return `${KINDS[conversation.kind]}${title}${span}`
}

function messageHead(message: ConversationMessage, timezone: string, match: boolean): string {
  return `[#${message.seq} · ${formatTime(message.time, timezone)} · ${SPEAKERS[message.speaker]}${match ? " · match" : ""}]`
}

function matchedText(match: ConversationMatch): string {
  const { message } = match
  const at = [...message.text.slice(0, match.start)].length
  const excerpt = window(message.text, at - RESULT_BOUNDS.beforeMatch, RESULT_BOUNDS.match)
  return spokenLines({ ...message, text: excerpt }).join("\n")
}

function renderGroup(
  conversation: Conversation,
  matches: readonly ConversationMatch[],
  timezone: string,
): string[] {
  const matched = new Map(matches.map((match) => [match.index, match]))
  const shown = new Set<number>()
  for (const index of matched.keys()) {
    for (const near of [index - 1, index, index + 1]) {
      if (near >= 0 && near < conversation.messages.length) shown.add(near)
    }
  }
  const lines = [`## ${heading(conversation, timezone)}`, `session: ${conversation.sessionId}`]
  let previous: number | undefined
  for (const index of [...shown].sort((left, right) => left - right)) {
    if (previous !== undefined && index > previous + 1) lines.push(ELLIPSIS)
    previous = index
    const message = conversation.messages[index] as ConversationMessage
    const match = matched.get(index)
    lines.push(
      messageHead(message, timezone, match !== undefined),
      match === undefined
        ? clipped(spokenLines(message).join("\n"), RESULT_BOUNDS.neighbor)
        : matchedText(match),
    )
  }
  return lines
}

export interface UnreadConversation {
  readonly sessionId: string
  readonly problem: string
}

function unreadLines(unread: readonly UnreadConversation[]): string[] {
  return unread.length === 0
    ? []
    : [
        "",
        `${counted(unread.length, { one: "conversation", other: "conversations" })} could not be read:`,
        ...unread.map((item) => `- ${item.sessionId}: ${item.problem}`),
      ]
}

export function renderSearch(
  query: string,
  outcome: SearchOutcome,
  unread: readonly UnreadConversation[],
  timezone: string,
): string {
  if (outcome.matches.length === 0) {
    return [
      `No past conversation with your owner mentions ${JSON.stringify(query)}.`,
      ...unreadLines(unread),
    ].join("\n")
  }
  const groups = new Map<Conversation, ConversationMatch[]>()
  for (const match of outcome.matches) {
    const group = groups.get(match.conversation) ?? []
    group.push(match)
    groups.set(match.conversation, group)
  }
  const more = outcome.total - outcome.matches.length
  return [
    `Matches for ${JSON.stringify(query)} in your past conversations with your owner, newest first (times in ${timezone}). ${RECORD_NOTE}`,
    ...[...groups].flatMap(([conversation, matches]) => [
      "",
      ...renderGroup(conversation, matches, timezone),
    ]),
    ...(more > 0
      ? [
          "",
          `(${counted(more, { one: "more matching message", other: "more matching messages" })}; narrow the query or the period, or raise limit)`,
        ]
      : []),
    ...unreadLines(unread),
  ].join("\n")
}

export function renderRead(
  conversation: Conversation,
  index: number,
  around: { readonly earlier: number; readonly later: number },
  timezone: string,
): string {
  const start = Math.max(0, index - around.earlier)
  const end = Math.min(conversation.messages.length, index + around.later + 1)
  const later = conversation.messages.length - end
  return [
    `${heading(conversation, timezone)} (times in ${timezone}). ${RECORD_NOTE}`,
    `session: ${conversation.sessionId}`,
    ...(start > 0 ? [`(${counted(start, EARLIER)})`] : []),
    ...conversation.messages
      .slice(start, end)
      .flatMap((message) => [
        messageHead(message, timezone, false),
        clipped(spokenLines(message).join("\n"), RESULT_BOUNDS.read),
      ]),
    ...(later > 0 ? [`(${counted(later, LATER)})`] : []),
  ].join("\n")
}
