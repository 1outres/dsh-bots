import { createHash } from "node:crypto"
import type { BotConnectorEnvironment } from "@1outres/dsh-bot-core"
import type { gmail_v1 } from "@googleapis/gmail"
import type { AttachmentFact, OriginalFacts, Outgoing } from "./compose"
import { readMessage } from "./message"
import { buildMime, type MimeAttachment } from "./mime"

/** Most bytes of every attachment of one message together. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
/** Most characters of a quoted or forwarded text. */
export const MAX_ORIGINAL_TEXT = 100_000

const TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  html: "text/html",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

export function mimeTypeOf(filename: string): string {
  const extension = /\.([A-Za-z0-9]+)$/.exec(filename)?.[1]?.toLowerCase()
  return (extension === undefined ? undefined : TYPES[extension]) ?? "application/octet-stream"
}

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex")

export interface LoadedAttachment {
  readonly fact: AttachmentFact
  readonly data: Uint8Array
}

function within(attachments: readonly { readonly size: number }[]) {
  const total = attachments.reduce((sum, item) => sum + item.size, 0)
  if (total > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `the attachments are larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MiB together`,
    )
  }
}

/** Read files of the bot's environment to attach. */
export async function readFiles(
  environment: BotConnectorEnvironment,
  paths: readonly string[],
): Promise<LoadedAttachment[]> {
  const loaded: LoadedAttachment[] = []
  for (const path of paths) {
    const absolute = path.startsWith("/") ? path : `${environment.workspace}/${path}`
    const data = await environment.readFile(absolute, { maxBytes: MAX_ATTACHMENT_BYTES })
    const filename = absolute.split("/").pop() ?? "attachment"
    loaded.push({
      fact: {
        source: { kind: "file", path: absolute },
        filename,
        mimeType: mimeTypeOf(filename),
        size: data.byteLength,
        sha256: sha256(data),
      },
      data,
    })
    within(loaded.map((item) => item.fact))
  }
  return loaded
}

export async function downloadAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  attachmentId: string,
): Promise<Uint8Array> {
  const response = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  })
  return Buffer.from(response.data.data ?? "", "base64url")
}

/** Read the original of a reply or forward; its text only when it is needed. */
export async function readOriginal(
  gmail: gmail_v1.Gmail,
  messageId: string,
  withText: boolean,
): Promise<OriginalFacts> {
  const response = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" })
  const message = readMessage(response.data)
  if (withText && message.text.length > MAX_ORIGINAL_TEXT) {
    throw new Error(`the message's text is longer than ${MAX_ORIGINAL_TEXT} characters`)
  }
  return {
    id: message.id,
    threadId: message.threadId,
    ...(message.messageId === undefined ? {} : { messageId: message.messageId }),
    ...(message.references === undefined ? {} : { references: message.references }),
    subject: message.subject ?? "",
    from: message.from ?? "",
    ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
    to: message.to ?? "",
    cc: message.cc ?? "",
    date: message.date ?? "",
    ...(withText ? { text: message.text } : {}),
  }
}

/** The original's attachments with their hashes, for a forward that carries them. */
export async function forwardedAttachments(
  gmail: gmail_v1.Gmail,
  messageId: string,
): Promise<LoadedAttachment[]> {
  const response = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" })
  const message = readMessage(response.data)
  within(message.attachments)
  const loaded: LoadedAttachment[] = []
  for (const [index, attachment] of message.attachments.entries()) {
    const data = await downloadAttachment(gmail, messageId, attachment.attachmentId)
    loaded.push({
      fact: {
        source: { kind: "forwarded", index },
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: data.byteLength,
        sha256: sha256(data),
      },
      data,
    })
  }
  return loaded
}

/**
 * The attachments' bytes now, checked against what the preview showed: a
 * file changed since then (or a forwarded attachment that differs) fails the send.
 */
export async function loadApproved(
  facts: readonly AttachmentFact[],
  read: (fact: AttachmentFact) => Promise<Uint8Array>,
): Promise<MimeAttachment[]> {
  const loaded: MimeAttachment[] = []
  for (const fact of facts) {
    const data = await read(fact)
    if (sha256(data) !== fact.sha256) {
      throw new Error(
        `${fact.filename} changed since it was shown for approval, so nothing was sent`,
      )
    }
    loaded.push({ filename: fact.filename, mimeType: fact.mimeType, data })
  }
  return loaded
}

export function mimeOf(message: Outgoing, attachments: readonly MimeAttachment[]): string {
  return buildMime({
    from: message.from,
    to: message.to,
    cc: message.cc,
    bcc: message.bcc,
    subject: message.subject,
    body: message.body,
    ...(message.inReplyTo === undefined ? {} : { inReplyTo: message.inReplyTo }),
    ...(message.references === undefined ? {} : { references: message.references }),
    attachments,
  })
}

/** Send the MIME as is (an upload, so large attachments fit). */
export async function sendMime(
  gmail: gmail_v1.Gmail,
  upload: { readonly rootUrl: string },
  mime: string,
  threadId: string | undefined,
) {
  const response = await gmail.users.messages.send(
    {
      userId: "me",
      requestBody: threadId === undefined ? {} : { threadId },
      media: { mimeType: "message/rfc822", body: mime },
    },
    { rootUrl: upload.rootUrl },
  )
  return { id: response.data.id ?? "", threadId: response.data.threadId ?? "" }
}
/**
 * A forwarded attachment's bytes now: Gmail's attachment ids change between
 * reads, so it is found again by its place and name in the message.
 */
export async function forwardedAttachment(
  gmail: gmail_v1.Gmail,
  messageId: string,
  index: number,
  filename: string,
): Promise<Uint8Array> {
  const response = await gmail.users.messages.get({ userId: "me", id: messageId, format: "full" })
  const attachment = readMessage(response.data).attachments[index]
  if (attachment?.filename !== filename) {
    throw new Error(
      `${filename} is no longer attachment ${index + 1} of the message, so nothing was sent`,
    )
  }
  return downloadAttachment(gmail, messageId, attachment.attachmentId)
}
