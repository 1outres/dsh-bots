/**
 * The MIME message the connector sends, built by hand (RFC 5322, 2045,
 * 2047, 2231): what the preview shows is what is sent, nothing is added.
 * Text is UTF-8 `text/plain` only, sent base64; attachments go in a
 * `multipart/mixed` whose boundary is derived from the content.
 */
import { createHash } from "node:crypto"
import type { Mailbox } from "./addresses"

export interface MimeAttachment {
  readonly filename: string
  readonly mimeType: string
  readonly data: Uint8Array
}

export interface MimeMessage {
  readonly from: Mailbox
  readonly to: readonly Mailbox[]
  readonly cc: readonly Mailbox[]
  readonly bcc: readonly Mailbox[]
  readonly subject: string
  readonly body: string
  readonly inReplyTo?: string
  readonly references?: readonly string[]
  readonly attachments: readonly MimeAttachment[]
}

const CRLF = "\r\n"
const ASCII_TEXT = /^[\x20-\x7e]*$/
const ATOM_TEXT = /^[A-Za-z0-9!#$%&'*+\-/=?^_`{|}~ ]*$/
const MESSAGE_ID = /^<[^<>\s]+>$/
const MEDIA_TYPE = /^[A-Za-z0-9][\w!#$&^.+-]*\/[A-Za-z0-9][\w!#$&^.+-]*$/

function base64Lines(data: Uint8Array): string {
  const text = Buffer.from(data).toString("base64")
  const lines: string[] = []
  for (let index = 0; index < text.length; index += 76) lines.push(text.slice(index, index + 76))
  return lines.join(CRLF)
}

/** RFC 2047 encoded words of at most 45 bytes each, never splitting a character. */
function encodedWords(text: string): string {
  const words: string[] = []
  let chunk = ""
  for (const char of text) {
    if (Buffer.byteLength(chunk + char) > 45) {
      words.push(chunk)
      chunk = ""
    }
    chunk += char
  }
  if (chunk !== "" || words.length === 0) words.push(chunk)
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word).toString("base64")}?=`).join(`${CRLF} `)
}

/** Unstructured header text (Subject): as is when plain ASCII, else encoded. */
export function headerText(text: string): string {
  return ASCII_TEXT.test(text) && text.length <= 900 ? text : encodedWords(text)
}

function displayName(name: string): string {
  if (!ASCII_TEXT.test(name)) return encodedWords(name)
  return ATOM_TEXT.test(name) ? name : `"${name.replace(/(["\\])/g, "\\$1")}"`
}

export function mailboxHeader(mailbox: Mailbox): string {
  return mailbox.name === undefined
    ? mailbox.address
    : `${displayName(mailbox.name)} <${mailbox.address}>`
}

function addressHeader(name: string, list: readonly Mailbox[]): string[] {
  return list.length === 0 ? [] : [`${name}: ${list.map(mailboxHeader).join(`,${CRLF} `)}`]
}

/** RFC 2231 parameter value of a file name. */
function fileParameter(name: string, filename: string): string {
  if (ASCII_TEXT.test(filename) && !/["\\]/.test(filename)) return `${name}="${filename}"`
  return `${name}*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`
}

const textPart = (body: string) =>
  [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(body.replace(/\r?\n/g, CRLF), "utf8")),
  ].join(CRLF)

function attachmentPart(attachment: MimeAttachment): string {
  if (!MEDIA_TYPE.test(attachment.mimeType)) {
    throw new Error(`"${attachment.mimeType}" is not a media type`)
  }
  return [
    `Content-Type: ${attachment.mimeType}; ${fileParameter("name", attachment.filename)}`,
    `Content-Disposition: attachment; ${fileParameter("filename", attachment.filename)}`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(attachment.data),
  ].join(CRLF)
}

/** The message as sent (CRLF line ends). */
export function buildMime(message: MimeMessage): string {
  for (const id of [message.inReplyTo, ...(message.references ?? [])]) {
    if (id !== undefined && !MESSAGE_ID.test(id)) throw new Error(`"${id}" is not a Message-ID`)
  }
  const headers = [
    `From: ${mailboxHeader(message.from)}`,
    ...addressHeader("To", message.to),
    ...addressHeader("Cc", message.cc),
    ...addressHeader("Bcc", message.bcc),
    `Subject: ${headerText(message.subject)}`,
    ...(message.inReplyTo === undefined ? [] : [`In-Reply-To: ${message.inReplyTo}`]),
    ...(message.references === undefined || message.references.length === 0
      ? []
      : [`References: ${message.references.join(`${CRLF} `)}`]),
    "MIME-Version: 1.0",
  ]
  if (message.attachments.length === 0) return [...headers, textPart(message.body)].join(CRLF)
  const digest = createHash("sha256").update(message.body)
  for (const attachment of message.attachments)
    digest.update(attachment.filename).update(attachment.data)
  const boundary = `=_dsh_${digest.digest("hex").slice(0, 32)}`
  const parts = [textPart(message.body), ...message.attachments.map(attachmentPart)]
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.flatMap((part) => [`--${boundary}`, part]),
    `--${boundary}--`,
    "",
  ].join(CRLF)
}

/** base64url without padding, as Gmail's `raw` takes a message. */
export function rawOf(mime: string): string {
  return Buffer.from(mime, "utf8").toString("base64url")
}
