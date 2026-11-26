import type { gmail_v1 } from "@googleapis/gmail"

export interface ReadMessage {
  readonly id: string
  readonly threadId: string
  readonly labelIds: readonly string[]
  readonly from?: string
  readonly to?: string
  readonly cc?: string
  readonly bcc?: string
  readonly replyTo?: string
  readonly subject?: string
  readonly date?: string
  readonly messageId?: string
  readonly references?: string
  readonly authenticationResults?: string
  readonly snippet: string
  readonly internalDate?: number
  readonly text: string
  readonly attachments: readonly ReadAttachment[]
}

export interface ReadAttachment {
  readonly attachmentId: string
  readonly filename: string
  readonly mimeType: string
  readonly size: number
}

type Part = gmail_v1.Schema$MessagePart

function header(part: Part | undefined, name: string): string | undefined {
  const value = part?.headers?.find(
    (item) => item.name?.toLowerCase() === name.toLowerCase(),
  )?.value
  return value === null || value === undefined ? undefined : value
}

function decode(data: string | null | undefined, charset: string | undefined): string {
  if (data === null || data === undefined) return ""
  const bytes = Buffer.from(data, "base64url")
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes)
  } catch {
    return new TextDecoder("utf-8").decode(bytes)
  }
}

function charsetOf(part: Part): string | undefined {
  return /charset="?([^";]+)"?/i.exec(header(part, "Content-Type") ?? "")?.[1]
}

function walk(part: Part | undefined, visit: (part: Part) => void) {
  if (part === undefined) return
  visit(part)
  for (const child of part.parts ?? []) walk(child, visit)
}

export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function readMessage(message: gmail_v1.Schema$Message): ReadMessage {
  let plain: string | undefined
  let html: string | undefined
  const attachments: ReadAttachment[] = []
  walk(message.payload ?? undefined, (part) => {
    const type = (part.mimeType ?? "").toLowerCase()
    const attachmentId = part.body?.attachmentId
    if (part.filename && attachmentId) {
      attachments.push({
        attachmentId,
        filename: part.filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        size: part.body?.size ?? 0,
      })
      return
    }
    if (type === "text/plain" && plain === undefined)
      plain = decode(part.body?.data, charsetOf(part))
    if (type === "text/html" && html === undefined) html = decode(part.body?.data, charsetOf(part))
  })
  const top = message.payload ?? undefined
  const optional = (name: string, value: string | undefined) =>
    value === undefined ? {} : { [name]: value }
  return {
    id: message.id ?? "",
    threadId: message.threadId ?? "",
    labelIds: message.labelIds ?? [],
    ...optional("from", header(top, "From")),
    ...optional("to", header(top, "To")),
    ...optional("cc", header(top, "Cc")),
    ...optional("bcc", header(top, "Bcc")),
    ...optional("replyTo", header(top, "Reply-To")),
    ...optional("subject", header(top, "Subject")),
    ...optional("date", header(top, "Date")),
    ...optional("messageId", header(top, "Message-ID") ?? header(top, "Message-Id")),
    ...optional("references", header(top, "References")),
    ...optional("authenticationResults", header(top, "Authentication-Results")),
    snippet: message.snippet ?? "",
    ...(message.internalDate ? { internalDate: Number(message.internalDate) } : {}),
    text: plain ?? (html === undefined ? "" : htmlText(html)),
    attachments,
  }
}

export function headline(message: ReadMessage): string {
  return [
    `From: ${message.from ?? "(unknown)"}`,
    `Subject: ${message.subject ?? "(no subject)"}`,
    ...(message.date === undefined ? [] : [`Date: ${message.date}`]),
  ].join(" · ")
}

export const METADATA_HEADERS = [
  "From",
  "To",
  "Cc",
  "Subject",
  "Date",
  "Message-ID",
  "Authentication-Results",
]
