import type { BotTurnState } from "../../channel-contract"
import type {
  MainPresentedFile,
  MainTimelineFile,
  MainTimelineImage,
  MainTimelineItem,
  MainTurnOutcome,
} from "../../shared/main-view"
import { type AssistantBlock, endedTurnOf, replyOf, type TurnEndReason } from "../channels/feed"
import { type HeldQueue, offered, settled, spokenOf } from "../channels/held-queue"
import { formatBytes } from "../channels/inbound"
import { PRESENTED_EVENT } from "../channels/presented"
import { silencerCallsOf } from "../channels/stay-silent"
import type { LoggedEvent, SessionLog } from "../conversations/history"
import { personTextOf } from "./origin"

const MAINTENANCE_SOURCE = "bot-main"

type TurnKind = "pending" | "shown" | "maintenance"

interface RunningTurn {
  readonly turn: number
  readonly kind: TurnKind
  readonly silent: boolean
  readonly silencers: readonly string[]
  readonly held: HeldQueue<MainTimelineItem>
}

export interface TimelineFold {
  readonly sessionId: string
  readonly running: RunningTurn | undefined
}

export interface Folded {
  readonly fold: TimelineFold
  readonly items: readonly MainTimelineItem[]
}

export const emptyFold = (sessionId: string): TimelineFold => ({ sessionId, running: undefined })

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

function classified(running: RunningTurn | undefined, kind: Exclude<TurnKind, "pending">) {
  return running === undefined || running.kind !== "pending" ? running : { ...running, kind }
}

const seen = (running: RunningTurn | undefined) =>
  running === undefined || (running.kind === "shown" && !running.silent)

function assistantBlocksOf(message: Record<string, unknown>): readonly AssistantBlock[] {
  return blocksOf(message).map((block) => {
    const text = stringOf(block.text)
    const id = stringOf(block.id)
    const name = stringOf(block.name)
    return {
      type: String(block.type),
      ...(text === undefined ? {} : { text }),
      ...(id === undefined ? {} : { id }),
      ...(name === undefined ? {} : { name }),
    }
  })
}

const unchanged = (fold: TimelineFold): Folded => ({ fold, items: [] })

function onUser(fold: TimelineFold, event: LoggedEvent): Folded {
  const message = event.data
  if (!isRecord(message) || !isRecord(message.source)) return unchanged(fold)
  const source = stringOf(message.source.kind)
  const running = classified(fold.running, source === MAINTENANCE_SOURCE ? "maintenance" : "shown")
  const next = withRunning(fold, running)
  if (source !== "user" || message.role !== "user") return unchanged(next)
  const item = personItem(fold.sessionId, event, message)
  return { fold: next, items: item === undefined ? [] : [item] }
}

function replyItemOf(
  sessionId: string,
  event: LoggedEvent,
  data: Record<string, unknown>,
  message: Record<string, unknown>,
  blocks: readonly AssistantBlock[],
): MainTimelineItem | undefined {
  const id = stringOf(message.id)
  if (id === undefined) return undefined
  const reply = replyOf({
    message: { id, content: blocks },
    ...(data.interrupted === true ? { interrupted: true as const } : {}),
  })
  if (reply === undefined) return undefined
  return {
    kind: "reply",
    id: reply.id,
    sessionId,
    seq: event.seq,
    at: event.time,
    text: reply.text,
    interrupted: reply.interrupted,
  }
}

function onAssistant(fold: TimelineFold, event: LoggedEvent): Folded {
  const data = event.data
  if (!isRecord(data) || !isRecord(data.message)) return unchanged(fold)
  const running = classified(fold.running, "shown")
  const blocks = assistantBlocksOf(data.message)
  const item = seen(running)
    ? replyItemOf(fold.sessionId, event, data, data.message, blocks)
    : undefined
  if (running === undefined) return { fold, items: item === undefined ? [] : [item] }
  const silencers = silencerCallsOf(blocks)
  const listening = { ...running, silencers: [...running.silencers, ...silencers] }
  if (item === undefined) return unchanged(withRunning(fold, listening))
  const { queue, spoken } = offered(running.held, item, silencers)
  return { fold: withRunning(fold, { ...listening, held: queue }), items: spoken }
}

function onToolResult(fold: TimelineFold, event: LoggedEvent): Folded {
  const running = fold.running
  const data = event.data
  if (running === undefined || !isRecord(data) || !isRecord(data.message)) return unchanged(fold)
  const callId = stringOf(data.message.toolCallId)
  if (callId === undefined || !running.silencers.includes(callId)) return unchanged(fold)
  const silenced = data.message.isError !== true
  const { queue, spoken } = settled(running.held, { callId, silenced })
  return {
    fold: withRunning(fold, {
      ...running,
      silent: running.silent || silenced,
      silencers: running.silencers.filter((id) => id !== callId),
      held: queue,
    }),
    items: spoken,
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

function outcomeOf(state: BotTurnState): MainTurnOutcome["outcome"] | undefined {
  switch (state.phase) {
    case "failed":
      return { kind: "failed", message: state.message }
    case "cancelled":
      return { kind: "stopped", by: state.by }
    default:
      return undefined
  }
}

function onTurnEnd(fold: TimelineFold, event: LoggedEvent): Folded {
  const running = fold.running
  const data = event.data
  const turn = turnNumberOf(data)
  if (running === undefined || turn !== running.turn) return unchanged(fold)
  const next = withRunning(fold, undefined)
  if (running.kind !== "shown" || !isRecord(data) || !isRecord(data.reason)) return unchanged(next)
  const reason = reasonOf(data.reason)
  const state = reason === undefined ? undefined : endedTurnOf(reason)
  if (state === undefined) return unchanged(next)
  const outcome = outcomeOf(state)
  const ended: MainTurnOutcome | undefined =
    outcome === undefined
      ? undefined
      : {
          kind: "turn",
          id: `${fold.sessionId}#turn-${turn}`,
          sessionId: fold.sessionId,
          seq: event.seq,
          at: event.time,
          outcome,
        }
  return { fold: next, items: [...spokenOf(running.held), ...(ended === undefined ? [] : [ended])] }
}

export function foldEvent(fold: TimelineFold, event: LoggedEvent): Folded {
  switch (event.type) {
    case "turn/start": {
      const turn = turnNumberOf(event.data)
      return turn === undefined
        ? unchanged(fold)
        : {
            fold: withRunning(fold, {
              turn,
              kind: "pending",
              silent: false,
              silencers: [],
              held: [],
            }),
            items: [],
          }
    }
    case "turn/end":
      return onTurnEnd(fold, event)
    case "user/message":
      return event.surfaceOp === "append" ? onUser(fold, event) : unchanged(fold)
    case "assistant/message":
      return event.surfaceOp === "append" ? onAssistant(fold, event) : unchanged(fold)
    case "tool/result":
      return onToolResult(fold, event)
    case PRESENTED_EVENT: {
      const files = presentedOf(event.data)
      if (files.length === 0 || !seen(fold.running)) return unchanged(fold)
      return {
        fold,
        items: [
          {
            kind: "presented",
            id: `${fold.sessionId}#${event.seq}`,
            sessionId: fold.sessionId,
            seq: event.seq,
            at: event.time,
            files,
          },
        ],
      }
    }
    default:
      return unchanged(fold)
  }
}

export interface Timeline {
  readonly fold: TimelineFold
  readonly items: readonly MainTimelineItem[]
  readonly cursor: number
}

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
    items.push(...folded.items)
  }
  return { fold, items, cursor }
}
