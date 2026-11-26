/**
 * A Main session's log as its channels saw it (docs/specs/bot-main-view.md §2),
 * folded one event at a time, so a stored log and a live one read alike:
 * people's messages, the replies and presented files of the turns the channels
 * see (not a maintenance turn's, nor what a turn produced after a successful
 * `stay_silent`), and the turns that failed or were stopped.
 */
import type {
  MainPresentedFile,
  MainTimelineFile,
  MainTimelineImage,
  MainTimelineItem,
} from "../../shared/main-view"
import { endedTurnOf, replyOf, type TurnEndReason } from "../channels/feed"
import { formatBytes } from "../channels/inbound"
import { PRESENTED_EVENT } from "../channels/presented"
import type { LoggedEvent, SessionLog } from "../conversations/history"
import { personTextOf } from "./origin"

/** The message source of a maintenance turn's prompt (host/mains/turns.ts). */
const MAINTENANCE_SOURCE = "bot-main"
const STAY_SILENT = "stay_silent"

type TurnKind = "pending" | "shown" | "maintenance"

interface RunningTurn {
  readonly turn: number
  readonly kind: TurnKind
  readonly silent: boolean
  /** Call ids of the turn's `stay_silent` calls, until their results. */
  readonly silencers: readonly string[]
}

export interface TimelineFold {
  readonly sessionId: string
  readonly running: RunningTurn | undefined
}

export interface Folded {
  readonly fold: TimelineFold
  readonly item?: MainTimelineItem
}

export const emptyFold = (sessionId: string): TimelineFold => ({ sessionId, running: undefined })

/** Whether a turn the channels see runs. */
export const replyingOf = (fold: TimelineFold): boolean => fold.running?.kind === "shown"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

function blocksOf(message: Record<string, unknown>): readonly Record<string, unknown>[] {
  const content = message.content
  return Array.isArray(content) ? content.filter(isRecord) : []
}

function imageOf(block: Record<string, unknown>): MainTimelineImage | undefined {
  const attachment = block.attachment
  if (block.type !== "image" || !isRecord(attachment)) return undefined
  const attachmentId = stringOf(attachment.attachmentId)
  const mediaType = stringOf(attachment.mediaType)
  const bytes = numberOf(attachment.bytes)
  const width = numberOf(attachment.width)
  const height = numberOf(attachment.height)
  if (
    attachmentId === undefined ||
    mediaType === undefined ||
    bytes === undefined ||
    width === undefined ||
    height === undefined
  ) {
    return undefined
  }
  const name = stringOf(attachment.name)
  return { attachmentId, mediaType, bytes, width, height, ...(name === undefined ? {} : { name }) }
}

function fileOf(block: Record<string, unknown>): MainTimelineFile | undefined {
  const attachment = block.attachment
  if (block.type !== "file" || !isRecord(attachment)) return undefined
  const name = stringOf(attachment.name)
  const bytes = numberOf(attachment.bytes)
  return name === undefined || bytes === undefined ? undefined : { name, size: formatBytes(bytes) }
}

const texts = (blocks: readonly Record<string, unknown>[]) =>
  blocks.flatMap((block) => {
    const text = block.type === "text" ? stringOf(block.text) : undefined
    return text === undefined || text.trim() === "" ? [] : [text.trim()]
  })

function personItem(
  sessionId: string,
  event: LoggedEvent,
  message: Record<string, unknown>,
): MainTimelineItem | undefined {
  const id = stringOf(message.id)
  if (id === undefined) return undefined
  const blocks = blocksOf(message)
  const spoken = personTextOf(texts(blocks).join("\n\n"))
  return {
    kind: "person",
    id,
    sessionId,
    seq: event.seq,
    at: event.time,
    author: spoken.author,
    text: spoken.text,
    images: blocks.flatMap((block) => imageOf(block) ?? []),
    files: [...blocks.flatMap((block) => fileOf(block) ?? []), ...spoken.saved],
  }
}

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1)

function presentedOf(data: unknown): readonly MainPresentedFile[] {
  if (!isRecord(data) || !Array.isArray(data.files)) return []
  return data.files.filter(isRecord).flatMap((file): MainPresentedFile[] => {
    const path = stringOf(file.path)
    if (path === undefined) return []
    const description = stringOf(file.description)?.trim()
    return [
      {
        path,
        name: baseName(path),
        ...(description === undefined || description === "" ? {} : { description }),
      },
    ]
  })
}

function turnNumberOf(data: unknown): number | undefined {
  return isRecord(data) ? numberOf(data.turn) : undefined
}

const withRunning = (fold: TimelineFold, running: RunningTurn | undefined): TimelineFold => ({
  ...fold,
  running,
})

/** The running turn once its kind is known from its first message. */
function classified(running: RunningTurn | undefined, kind: Exclude<TurnKind, "pending">) {
  return running === undefined || running.kind !== "pending" ? running : { ...running, kind }
}

const seen = (running: RunningTurn | undefined) =>
  running === undefined || (running.kind === "shown" && !running.silent)

function silencersOf(message: Record<string, unknown>): readonly string[] {
  return blocksOf(message).flatMap((block) => {
    const id = stringOf(block.id)
    return block.type === "tool-call" && block.name === STAY_SILENT && id !== undefined ? [id] : []
  })
}

function onUser(fold: TimelineFold, event: LoggedEvent): Folded {
  const message = event.data
  if (!isRecord(message) || !isRecord(message.source)) return { fold }
  const source = stringOf(message.source.kind)
  const running = classified(fold.running, source === MAINTENANCE_SOURCE ? "maintenance" : "shown")
  const next = withRunning(fold, running)
  if (source !== "user" || message.role !== "user") return { fold: next }
  const item = personItem(fold.sessionId, event, message)
  return item === undefined ? { fold: next } : { fold: next, item }
}

function onAssistant(fold: TimelineFold, event: LoggedEvent): Folded {
  const data = event.data
  if (!isRecord(data) || !isRecord(data.message)) return { fold }
  const message = data.message
  const running = classified(fold.running, "shown")
  const silencers = silencersOf(message)
  const next = withRunning(
    fold,
    running === undefined || silencers.length === 0
      ? running
      : { ...running, silencers: [...running.silencers, ...silencers] },
  )
  const id = stringOf(message.id)
  if (!seen(running) || id === undefined) return { fold: next }
  const reply = replyOf({
    message: {
      id,
      content: blocksOf(message).map((block) => ({
        type: String(block.type),
        ...(typeof block.text === "string" ? { text: block.text } : {}),
      })),
    },
    ...(data.interrupted === true ? { interrupted: true as const } : {}),
  })
  if (reply === undefined) return { fold: next }
  return {
    fold: next,
    item: {
      kind: "reply",
      id: reply.id,
      sessionId: fold.sessionId,
      seq: event.seq,
      at: event.time,
      text: reply.text,
      interrupted: reply.interrupted,
    },
  }
}

function onToolResult(fold: TimelineFold, event: LoggedEvent): Folded {
  const running = fold.running
  const data = event.data
  if (running === undefined || !isRecord(data) || !isRecord(data.message)) return { fold }
  const callId = stringOf(data.message.toolCallId)
  if (callId === undefined || !running.silencers.includes(callId)) return { fold }
  return {
    fold: withRunning(fold, {
      ...running,
      silent: running.silent || data.message.isError !== true,
      silencers: running.silencers.filter((id) => id !== callId),
    }),
  }
}

function reasonOf(value: Record<string, unknown>): TurnEndReason | undefined {
  switch (value.kind) {
    case "completed":
    case "blocked":
    case "max-tokens":
    case "interrupted":
    case "forked":
      return { kind: value.kind }
    case "aborted":
      return {
        kind: "aborted",
        reason: { kind: isRecord(value.reason) ? String(value.reason.kind) : "system" },
      }
    case "error":
      return {
        kind: "error",
        error: { message: isRecord(value.error) ? value.error.message : undefined },
      }
    default:
      return undefined
  }
}

function onTurnEnd(fold: TimelineFold, event: LoggedEvent): Folded {
  const running = fold.running
  const data = event.data
  const turn = turnNumberOf(data)
  if (running === undefined || turn !== running.turn) return { fold }
  const next = withRunning(fold, undefined)
  if (running.kind !== "shown" || !isRecord(data) || !isRecord(data.reason)) return { fold: next }
  const reason = reasonOf(data.reason)
  const state = reason === undefined ? undefined : endedTurnOf(reason)
  const base = {
    kind: "turn",
    id: `${fold.sessionId}#turn-${turn}`,
    sessionId: fold.sessionId,
    seq: event.seq,
    at: event.time,
  } as const
  switch (state?.phase) {
    case "failed":
      return { fold: next, item: { ...base, outcome: { kind: "failed", message: state.message } } }
    case "cancelled":
      return { fold: next, item: { ...base, outcome: { kind: "stopped", by: state.by } } }
    default:
      return { fold: next }
  }
}

/** One event of the session's own log (never an inherited one), in order. */
export function foldEvent(fold: TimelineFold, event: LoggedEvent): Folded {
  switch (event.type) {
    case "turn/start": {
      const turn = turnNumberOf(event.data)
      return turn === undefined
        ? { fold }
        : { fold: withRunning(fold, { turn, kind: "pending", silent: false, silencers: [] }) }
    }
    case "turn/end":
      return onTurnEnd(fold, event)
    case "user/message":
      return event.surfaceOp === "append" ? onUser(fold, event) : { fold }
    case "assistant/message":
      return event.surfaceOp === "append" ? onAssistant(fold, event) : { fold }
    case "tool/result":
      return onToolResult(fold, event)
    case PRESENTED_EVENT: {
      const files = presentedOf(event.data)
      if (files.length === 0 || !seen(fold.running)) return { fold }
      return {
        fold,
        item: {
          kind: "presented",
          id: `${fold.sessionId}#${event.seq}`,
          sessionId: fold.sessionId,
          seq: event.seq,
          at: event.time,
          files,
        },
      }
    }
    default:
      return { fold }
  }
}

export interface Timeline {
  readonly fold: TimelineFold
  readonly items: readonly MainTimelineItem[]
  /** The last event folded, -1 for none. */
  readonly cursor: number
}

/** A session's timeline from its log; `until` leaves out what was logged after it (a former Main's end). */
export function timelineOf(sessionId: string, log: SessionLog, until?: number): Timeline {
  let fold = emptyFold(sessionId)
  const items: MainTimelineItem[] = []
  let cursor = -1
  for (const event of log.events) {
    cursor = Math.max(cursor, event.seq)
    if (event.seq < log.inheritedEventCount) continue
    if (until !== undefined && event.time > until) break
    const folded = foldEvent(fold, event)
    fold = folded.fold
    if (folded.item !== undefined) items.push(folded.item)
  }
  return { fold, items, cursor }
}
