import type { BotInboundAttachment, BotInboundMessage } from "@1outres/dsh-bot-core"
import type { MatrixApi, MatrixEvent } from "./matrix"

export const COMMAND_NAMES = ["stop", "status", "new", "pending", "help"] as const

export type MatrixCommand = (typeof COMMAND_NAMES)[number]

const MEDIA = new Set(["m.image", "m.file", "m.audio", "m.video"])
const SPOKEN = new Set(["m.text", "m.emote"])

export interface MessageEvent {
  readonly event: MatrixEvent
  readonly msgtype: string
  readonly text: string
  readonly replyTo?: string
  readonly media?: {
    readonly url: string
    readonly name: string
    readonly mediaType?: string
    readonly size?: number
  }
}

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

export function stripReplyFallback(body: string): string {
  const lines = body.split("\n")
  let at = 0
  while (at < lines.length && (lines[at] as string).startsWith("> ")) at += 1
  if (at === 0) return body
  if (lines[at] === "") at += 1
  return lines.slice(at).join("\n")
}

export function messageOf(event: MatrixEvent): MessageEvent | undefined {
  if (event.type !== "m.room.message") return undefined
  const { content } = event
  const msgtype = content.msgtype
  if (typeof msgtype !== "string" || (!SPOKEN.has(msgtype) && !MEDIA.has(msgtype))) return undefined
  const relates = recordOf(content["m.relates_to"])
  if (relates?.rel_type === "m.replace" || relates?.rel_type === "m.thread") return undefined
  const replyTo = recordOf(relates?.["m.in_reply_to"])?.event_id
  const body = typeof content.body === "string" ? content.body : ""
  const base = {
    event,
    msgtype,
    ...(typeof replyTo === "string" ? { replyTo } : {}),
  }
  if (SPOKEN.has(msgtype)) {
    const text = typeof replyTo === "string" ? stripReplyFallback(body) : body
    return { ...base, text }
  }
  if (typeof content.url !== "string" || content.file !== undefined) return undefined
  const info = recordOf(content.info)
  const filename = typeof content.filename === "string" ? content.filename : undefined
  const caption = filename !== undefined && filename !== body ? body : ""
  return {
    ...base,
    text: caption,
    media: {
      url: content.url,
      name: filename ?? (body.length > 0 ? body : "attachment"),
      ...(typeof info?.mimetype === "string" ? { mediaType: info.mimetype } : {}),
      ...(typeof info?.size === "number" ? { size: info.size } : {}),
    },
  }
}

export function commandOf(text: string): MatrixCommand | undefined {
  const trimmed = text.trim().toLowerCase()
  if (!trimmed.startsWith("!")) return undefined
  return COMMAND_NAMES.find((name) => trimmed === `!${name}`)
}

export interface Sender {
  readonly userId: string
  readonly displayName: string
}

export function inboundMessageOf(
  message: MessageEvent,
  sender: Sender,
  place: BotInboundMessage["place"],
  api: Pick<MatrixApi, "download">,
): BotInboundMessage {
  const text =
    message.msgtype === "m.emote" ? `* ${sender.displayName} ${message.text}` : message.text
  const attachments: BotInboundAttachment[] =
    message.media === undefined
      ? []
      : [
          {
            name: message.media.name,
            ...(message.media.mediaType === undefined
              ? {}
              : { mediaType: message.media.mediaType }),
            bytes: message.media.size ?? 0,
            read: (maxBytes, signal) =>
              api.download((message.media as { readonly url: string }).url, maxBytes, signal),
          },
        ]
  return {
    place,
    sender: {
      id: sender.userId,
      displayName: sender.displayName,
      handle: sender.userId,
      bot: false,
    },
    sentAt: message.event.originServerTs,
    text,
    attachments,
  }
}
