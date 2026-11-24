/**
 * What a sent message is, as one model: the preview a person approves and
 * the MIME the connector sends are both made from it, so they cannot differ.
 */
import type { ConnectorPreview, ConnectorPreviewField } from "@1outres/dsh-bot-core"
import {
  type Mailbox,
  parseMailbox,
  parseMailboxes,
  readMailboxes,
  sameAddress,
  showMailbox,
} from "./addresses"

/** A file attached to a message, as the snapshot read it. */
export interface AttachmentFact {
  /** Where it came from: a path in the bot's environment, or its place among a forwarded message's attachments. */
  readonly source:
    | { readonly kind: "file"; readonly path: string }
    | { readonly kind: "forwarded"; readonly index: number }
  readonly filename: string
  readonly mimeType: string
  readonly size: number
  readonly sha256: string
}

/** The message a reply or forward is about, as the snapshot read it. */
export interface OriginalFacts {
  readonly id: string
  readonly threadId: string
  readonly messageId?: string
  readonly references?: string
  readonly subject: string
  readonly from: string
  readonly replyTo?: string
  readonly to: string
  readonly cc: string
  readonly date: string
  /** Its text, when the reply quotes it or the message is forwarded. */
  readonly text?: string
}

export interface Outgoing {
  readonly from: Mailbox
  readonly to: readonly Mailbox[]
  readonly cc: readonly Mailbox[]
  readonly bcc: readonly Mailbox[]
  readonly subject: string
  readonly body: string
  readonly inReplyTo?: string
  readonly references?: readonly string[]
  readonly threadId?: string
  readonly attachments: readonly AttachmentFact[]
}

const CONTROL = /[\p{Cc}\p{Cf}\u2028\u2029]/u

function subjectOf(subject: string): string {
  if (CONTROL.test(subject)) throw new Error("the subject has a line break or control character")
  return subject.trim()
}

export function requireRecipients(message: Outgoing): Outgoing {
  if (message.to.length + message.cc.length + message.bcc.length === 0) {
    throw new Error("the message has no recipient")
  }
  return message
}

export interface SendArguments {
  readonly to: readonly string[]
  readonly cc?: readonly string[]
  readonly bcc?: readonly string[]
  readonly subject: string
  readonly body: string
}

export interface MessageArguments {
  readonly to?: readonly string[]
  readonly cc?: readonly string[]
  readonly bcc?: readonly string[]
  readonly subject: string
  readonly body: string
}

/** A message as written, recipients not required yet (a draft). */
export function composeMessage(
  args: MessageArguments,
  from: string,
  attachments: readonly AttachmentFact[],
): Outgoing {
  return {
    from: parseMailbox(from),
    to: parseMailboxes(args.to, "to"),
    cc: parseMailboxes(args.cc, "cc"),
    bcc: parseMailboxes(args.bcc, "bcc"),
    subject: subjectOf(args.subject),
    body: args.body,
    attachments,
  }
}

export function composeSend(
  args: SendArguments,
  from: string,
  attachments: readonly AttachmentFact[],
): Outgoing {
  return requireRecipients(composeMessage(args, from, attachments))
}

const prefixed = (prefix: string, subject: string) =>
  new RegExp(`^${prefix}:\\s`, "i").test(subject)
    ? subject
    : `${prefix[0]?.toUpperCase()}${prefix.slice(1)}: ${subject}`

function unique(list: readonly Mailbox[], except: readonly Mailbox[]): Mailbox[] {
  const seen: Mailbox[] = []
  for (const mailbox of list) {
    if ([...except, ...seen].some((other) => sameAddress(other.address, mailbox.address))) continue
    seen.push(mailbox)
  }
  return seen
}

function references(original: OriginalFacts): string[] {
  const previous = (original.references ?? "").split(/\s+/).filter((id) => /^<[^<>\s]+>$/.test(id))
  return original.messageId === undefined ? previous : [...previous, original.messageId]
}

function quoteOf(original: OriginalFacts): string {
  const quoted = (original.text ?? "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line === "" ? ">" : `> ${line}`))
    .join("\n")
  return `On ${original.date}, ${original.from} wrote:\n${quoted}`
}

export interface ReplyArguments {
  readonly body: string
  readonly reply_all: boolean
  readonly quote: boolean
  readonly cc?: readonly string[]
}

export function composeReply(
  args: ReplyArguments,
  from: string,
  original: OriginalFacts,
  attachments: readonly AttachmentFact[],
): Outgoing {
  const self = parseMailbox(from)
  const author = readMailboxes(original.replyTo ?? original.from)
  const theirTo = readMailboxes(original.to)
  const fromSelf = author.every((mailbox) => sameAddress(mailbox.address, self.address))
  const primary = fromSelf ? theirTo : author
  const to = unique(args.reply_all ? [...primary, ...theirTo] : primary, [self])
  const cc = unique(
    [...(args.reply_all ? readMailboxes(original.cc) : []), ...parseMailboxes(args.cc, "cc")],
    [self, ...to],
  )
  const ids = references(original)
  return requireRecipients({
    from: self,
    to,
    cc,
    bcc: [],
    subject: prefixed("re", original.subject),
    body: args.quote ? `${args.body}\n\n${quoteOf(original)}` : args.body,
    ...(original.messageId === undefined ? {} : { inReplyTo: original.messageId }),
    ...(ids.length === 0 ? {} : { references: ids }),
    threadId: original.threadId,
    attachments,
  })
}

export interface ForwardArguments {
  readonly to: readonly string[]
  readonly cc?: readonly string[]
  readonly bcc?: readonly string[]
  readonly comment?: string
}

export function composeForward(
  args: ForwardArguments,
  from: string,
  original: OriginalFacts,
  attachments: readonly AttachmentFact[],
): Outgoing {
  const forwarded = [
    "---------- Forwarded message ---------",
    `From: ${original.from}`,
    `Date: ${original.date}`,
    `Subject: ${original.subject}`,
    `To: ${original.to}`,
    ...(original.cc === "" ? [] : [`Cc: ${original.cc}`]),
    "",
    original.text ?? "",
  ].join("\n")
  return requireRecipients({
    from: parseMailbox(from),
    to: parseMailboxes(args.to, "to"),
    cc: parseMailboxes(args.cc, "cc"),
    bcc: parseMailboxes(args.bcc, "bcc"),
    subject: prefixed("fwd", original.subject),
    body:
      args.comment === undefined || args.comment === ""
        ? forwarded
        : `${args.comment}\n\n${forwarded}`,
    attachments,
  })
}

const list = (mailboxes: readonly Mailbox[]) => mailboxes.map(showMailbox).join(", ")

export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

/** Everything the message carries, in the order a mail client shows it; the body follows. */
export function previewOf(
  title: string,
  message: Outgoing,
  extra: readonly ConnectorPreviewField[] = [],
): ConnectorPreview {
  const fields: ConnectorPreviewField[] = [
    { label: "From", value: showMailbox(message.from) },
    { label: "To", value: list(message.to) || "(none)" },
    ...(message.cc.length === 0 ? [] : [{ label: "Cc", value: list(message.cc) }]),
    ...(message.bcc.length === 0 ? [] : [{ label: "Bcc", value: list(message.bcc) }]),
    { label: "Subject", value: message.subject === "" ? "(no subject)" : message.subject },
    ...(message.inReplyTo === undefined
      ? []
      : [{ label: "In reply to", value: message.inReplyTo }]),
    ...message.attachments.map((attachment, index) => ({
      label: `Attachment ${index + 1}`,
      value: `${attachment.filename} (${attachment.mimeType}, ${sizeLabel(attachment.size)}, sha256 ${attachment.sha256})`,
    })),
    ...extra,
  ]
  return { title, fields, body: message.body }
}
