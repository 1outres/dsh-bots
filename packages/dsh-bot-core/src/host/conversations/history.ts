import { type SpokenMessage, spokenMessageOf, type TranscriptMessage } from "../spoken-messages"
import type { ConversationSource } from "./sources"
import { surfaceOf } from "./surface"

export interface LoggedEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly surfaceOp?: unknown
  readonly data: unknown
}

export interface SessionLog {
  readonly inheritedEventCount: number
  readonly events: readonly LoggedEvent[]
}

export interface ConversationMessage extends SpokenMessage {
  readonly seq: number
  readonly time: number
}

export interface Conversation extends ConversationSource {
  readonly title?: string
  readonly messages: readonly ConversationMessage[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const optionalString = (value: unknown) => (typeof value === "string" ? value : undefined)

function block(value: unknown): TranscriptMessage["content"][number] | undefined {
  if (!isRecord(value) || typeof value.type !== "string") return undefined
  const text = optionalString(value.text)
  const name = optionalString(value.name)
  return {
    type: value.type,
    ...(text === undefined ? {} : { text }),
    ...(name === undefined ? {} : { name }),
  }
}

function transcriptMessage(event: LoggedEvent): TranscriptMessage {
  const message =
    event.type === "assistant/message" && isRecord(event.data) ? event.data.message : event.data
  const malformed = () => new Error(`event #${event.seq} (${event.type}) holds no message`)
  if (
    !isRecord(message) ||
    typeof message.id !== "string" ||
    typeof message.role !== "string" ||
    !Array.isArray(message.content) ||
    !isRecord(message.source) ||
    typeof message.source.kind !== "string"
  ) {
    throw malformed()
  }
  const content = message.content.map((value: unknown) => {
    const parsed = block(value)
    if (parsed === undefined) throw malformed()
    return parsed
  })
  const form = optionalString(message.source.form)
  return {
    id: message.id,
    role: message.role,
    content,
    source: { kind: message.source.kind, ...(form === undefined ? {} : { form }) },
  }
}

const MESSAGE_EVENTS: readonly string[] = ["user/message", "assistant/message"]

const isAppendedMessage = (event: LoggedEvent) =>
  MESSAGE_EVENTS.includes(event.type) && event.surfaceOp === "append"

export type InContext = ReadonlySet<string>

export function inContextOf(log: SessionLog): InContext {
  const surface = new Set(surfaceOf(log.events))
  return new Set(
    log.events.flatMap((event) =>
      surface.has(event.seq) && isAppendedMessage(event) ? [transcriptMessage(event).id] : [],
    ),
  )
}

function titleOf(events: readonly LoggedEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index] as LoggedEvent
    if (event.type !== "session/title" || !isRecord(event.data)) continue
    const { title } = event.data
    if (typeof title === "string" && title.trim() !== "") return title.trim()
  }
  return undefined
}

export function conversationOf(
  source: ConversationSource,
  log: SessionLog,
  inContext: InContext,
): Conversation {
  const messages = log.events.flatMap((event): ConversationMessage[] => {
    if (event.seq < log.inheritedEventCount || !isAppendedMessage(event)) return []
    const message = transcriptMessage(event)
    if (inContext.has(message.id)) return []
    const spoken = spokenMessageOf(message)
    return spoken === undefined ? [] : [{ ...spoken, seq: event.seq, time: event.time }]
  })
  const title = titleOf(log.events)
  return { ...source, ...(title === undefined ? {} : { title }), messages }
}
