import type { BotGroupPause, BotPeerWithdrawal } from "../../shared/peers"
import { headerName } from "../channels/header"
import type { NoticeContent } from "../notices/outbox"
import type { PeerMessageRecord } from "./domain"
import { PEER_LIMITS, type PeerRefusalReason } from "./limits"

export const QUOTE_LENGTH = 300

const MINUTE_MS = 60_000

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

function clip(text: string, length: number): string {
  const points = [...text]
  return points.length <= length ? text : `${points.slice(0, length).join("")}…`
}

export function clockTime(ms: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? ""
  return `${part("hour")}:${part("minute")}`
}

const minutes = (ms: number) => `${Math.round(ms / MINUTE_MS)} minutes`

export interface PeerMessageNotice {
  readonly messageId: string
  readonly message: PeerMessageRecord
  readonly fromName: string
  readonly groupName: string
  readonly replied: PeerMessageRecord | undefined
}

export function peerMessageNotice(notice: PeerMessageNotice): NoticeContent {
  const { messageId, message, replied } = notice
  const sender = `${headerName(notice.fromName)} (bot ${message.from}, group "${headerName(notice.groupName)}")`
  const expects = message.expectsReply ? "A reply is expected." : "No reply is needed."
  const head =
    message.replyTo === undefined || replied === undefined
      ? `[peer] ${sender} sent you message ${messageId} (thread ${message.threadId}). ${expects}`
      : `[peer] ${sender} replied to your message ${message.replyTo} with ${messageId} (thread ${message.threadId}). ${expects}`
  const quote =
    message.replyTo === undefined || replied === undefined
      ? []
      : [`> You wrote: ${clip(oneLine(replied.text), QUOTE_LENGTH)}`]
  return {
    text: [head, ...quote, message.text].join("\n"),
    summary: `${message.replyTo === undefined ? "Message" : "Reply"} from ${headerName(notice.fromName)}`,
  }
}

export interface UndeliveredItem {
  readonly messageId: string
  readonly toName: string
  readonly groupName: string
  readonly withdrawal: BotPeerWithdrawal
  readonly stopped: boolean
}

function undeliveredReason(item: UndeliveredItem): string {
  const to = headerName(item.toName)
  const group = headerName(item.groupName)
  switch (item.withdrawal) {
    case "left-group":
      return `${to} left the group "${group}".`
    case "group-deleted":
      return `the group "${group}" was deleted by your owner.`
    case "bot-deleted":
      return `${to} was deleted by your owner.`
    case "expired":
      return item.stopped
        ? `it was not delivered within 24 hours (${to}'s machine stayed stopped), so it was withdrawn.`
        : "it was not delivered within 24 hours, so it was withdrawn."
  }
}

function singleReason(item: UndeliveredItem): string {
  return item.withdrawal === "expired"
    ? undeliveredReason(item).replace(/^it was/, "was")
    : `was not delivered: ${undeliveredReason(item)}`
}

export function undeliveredNotice(items: readonly UndeliveredItem[]): NoticeContent {
  const [first] = items
  if (first === undefined) throw new Error("bot-core: an undelivered notice lists no message")
  if (items.length === 1) {
    return {
      text: `[peer] Your message ${first.messageId} to ${headerName(first.toName)} ${singleReason(first)}`,
      summary: `Message to ${headerName(first.toName)} not delivered`,
    }
  }
  return {
    text: [
      `[peer] ${items.length} of your messages were not delivered:`,
      ...items.map(
        (item) => `- ${item.messageId} to ${headerName(item.toName)}: ${undeliveredReason(item)}`,
      ),
    ].join("\n"),
    summary: `${items.length} peer messages not delivered`,
  }
}

export function pairPausedNotice(
  otherName: string,
  until: number,
  count: number,
  timezone: string,
): NoticeContent {
  const other = headerName(otherName)
  return {
    text: `[peer] Messages between you and ${other} are paused until ${clockTime(until, timezone)} (${count} messages in ${minutes(PEER_LIMITS.pair.windowMs)}). Do not work around it; tell your owner if the work needs it.`,
    summary: `Messages with ${other} paused`,
  }
}

export function groupPausedNotice(groupName: string, count: number): NoticeContent {
  const group = headerName(groupName)
  return {
    text: `[peer] Messages in the group "${group}" are paused: ${count} messages in ${minutes(PEER_LIMITS.group.windowMs)}. Your owner can resume them in the Web UI.`,
    summary: `Messages in ${group} paused`,
  }
}

export interface RefusalContext {
  readonly toName: string
  readonly groupName: string
  readonly threadId: string
  readonly timezone: string
}

function pauseText(pause: BotGroupPause, group: string): string {
  return pause.reason === "owner"
    ? `Not sent: your owner paused messages in the group "${group}". Do not try another way; tell your owner if the work needs it.`
    : `Not sent: messages in the group "${group}" are paused after too many messages, until your owner resumes them in the Web UI. Do not try another way; tell your owner if the work needs it.`
}

export function refusalText(reason: PeerRefusalReason, context: RefusalContext): string {
  const to = headerName(context.toName)
  const group = headerName(context.groupName)
  switch (reason.refusal) {
    case "paused":
      return pauseText(reason.pause, group)
    case "pair":
      return reason.starts
        ? `Not sent: you and ${to} exchanged ${reason.count} messages in ${minutes(PEER_LIMITS.pair.windowMs)}, so messages between you are paused until ${clockTime(reason.until, context.timezone)}. Do not work around it; tell your owner if the work needs it.`
        : `Not sent: messages between you and ${to} are paused until ${clockTime(reason.until, context.timezone)}. Wait, and tell your owner if the work needs it.`
    case "group":
      return `Not sent: the group "${group}" had ${reason.count} messages in ${minutes(PEER_LIMITS.group.windowMs)}, so messages in it are paused until your owner resumes them in the Web UI. Tell your owner if the work needs it.`
    case "thread":
      return `Not sent: the thread ${context.threadId} already has ${reason.count} messages. Wrap up without messaging ${to} again, and tell your owner if more is needed.`
    case "sender":
      return `Not sent: you sent ${reason.count} peer messages in the last hour. Wait until ${clockTime(reason.until, context.timezone)}, and tell your owner if the work needs it.`
    case "depth":
      return reason.depth === undefined
        ? "Not sent: bot-core cannot tell which peer conversation this turn belongs to, so it cannot start a new one here. Answer with reply_to, or tell your owner if more is needed."
        : "Not sent: this turn works on a peer's request that itself came from another peer's request, so it cannot pull in another bot. Answer the bot that asked you with reply_to, and tell your owner if more is needed."
  }
}
