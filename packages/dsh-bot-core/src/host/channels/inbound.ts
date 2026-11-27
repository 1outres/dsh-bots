import type {
  BotAttachmentCapability,
  BotDeliveryFailure,
  BotInboundAttachment,
  BotInboundMessage,
} from "../../channel-contract"
import { distinctNames, type InboxWriter, inboxFolderName, sanitizeFileName } from "./inbox"

export interface ImageLimits {
  readonly maxImageBytes: number
  readonly maxImagesPerMessage: number
  readonly maxMessageImageBytes: number
  readonly mediaTypes: readonly string[]
}

export interface AttachmentLimits {
  readonly maxCount: number
  readonly maxFileBytes: number
  readonly maxMessageBytes: number
}

export type PromptPart =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image"
      readonly mediaType: string
      readonly data: string
      readonly name?: string
    }

export type InboundContent = Pick<BotInboundMessage, "text" | "sentAt" | "attachments">

export interface InboundDeps {
  imageLimits(): ImageLimits | undefined
  readonly limits: AttachmentLimits
  inboxOf(botId: string): { readonly root: string; readonly writer: InboxWriter } | undefined
  encodeBase64(data: Uint8Array): string
}

export type ComposedPrompt =
  | {
      readonly ok: true
      readonly content: readonly PromptPart[]
      readonly images: number
      readonly saved: readonly string[]
    }
  | { readonly ok: false; readonly failure: BotDeliveryFailure }

export type AttachmentFacts = Pick<BotInboundAttachment, "name" | "mediaType" | "bytes">

interface Planned<A extends AttachmentFacts = BotInboundAttachment> {
  readonly attachment: A
  readonly image: string | undefined
  readonly limit: number
}

export type AttachmentPlan<A extends AttachmentFacts> =
  | { readonly ok: true; readonly planned: readonly Planned<A>[] }
  | { readonly ok: false; readonly failure: BotDeliveryFailure }

const refuse = (code: BotDeliveryFailure["code"], message: string) =>
  ({ ok: false, failure: { code, message } }) as const

const quote = (value: string) => JSON.stringify(value)
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function essenceOf(mediaType: string | undefined): string | undefined {
  const essence = mediaType?.split(";")[0]?.trim().toLowerCase()
  return essence === undefined || essence === "" ? undefined : essence
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KiB", "MiB", "GiB"]
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function planAttachments<A extends AttachmentFacts>(
  deps: Pick<InboundDeps, "imageLimits" | "limits">,
  capability: BotAttachmentCapability | undefined,
  attachments: readonly A[],
): AttachmentPlan<A> {
  if (attachments.length === 0) return { ok: true, planned: [] }
  if (capability === undefined)
    return refuse("too-many-attachments", "This channel passes no attachments.")
  const maxCount = Math.min(capability.maxCount, deps.limits.maxCount)
  if (attachments.length > maxCount) {
    return refuse("too-many-attachments", `At most ${maxCount} attachments fit in one message.`)
  }
  const images = deps.imageLimits()
  const imageTypes = new Set(images?.mediaTypes ?? [])
  const planned = attachments.map((attachment): Planned<A> => {
    const type = essenceOf(attachment.mediaType)
    const image = type !== undefined && imageTypes.has(type) ? type : undefined
    const limit =
      image === undefined || images === undefined
        ? Math.min(capability.maxBytes, deps.limits.maxFileBytes)
        : Math.min(capability.maxBytes, images.maxImageBytes, images.maxMessageImageBytes)
    return { attachment, image, limit }
  })
  for (const entry of planned) {
    if (entry.attachment.bytes > entry.limit) {
      const what = entry.image === undefined ? "file" : "image"
      return refuse(
        "too-large",
        `The ${what} ${quote(entry.attachment.name)} (${formatBytes(entry.attachment.bytes)}) is larger than ${formatBytes(entry.limit)}.`,
      )
    }
  }
  const pictured = planned.filter((entry) => entry.image !== undefined)
  if (images !== undefined && pictured.length > 0) {
    if (pictured.length > images.maxImagesPerMessage) {
      return refuse(
        "too-many-attachments",
        `At most ${images.maxImagesPerMessage} images fit in one message.`,
      )
    }
    const imageBytes = pictured.reduce((sum, entry) => sum + entry.attachment.bytes, 0)
    if (imageBytes > images.maxMessageImageBytes) {
      return refuse(
        "too-large",
        `The images together are larger than ${formatBytes(images.maxMessageImageBytes)}.`,
      )
    }
  }
  const total = planned.reduce((sum, entry) => sum + entry.attachment.bytes, 0)
  if (total > deps.limits.maxMessageBytes) {
    return refuse(
      "too-large",
      `The attachments together are larger than ${formatBytes(deps.limits.maxMessageBytes)}.`,
    )
  }
  return { ok: true, planned }
}

function savedText(saved: readonly { readonly path: string; readonly bytes: number }[]): string {
  return [
    "Attached files, saved in your workspace:",
    ...saved.map((file) => `- ${file.path} (${formatBytes(file.bytes)})`),
  ].join("\n")
}

export async function composePrompt(
  deps: InboundDeps,
  request: {
    readonly botId: string
    readonly source: string
    readonly capability: BotAttachmentCapability | undefined
    readonly message: InboundContent
    readonly header: string | undefined
  },
  signal: AbortSignal,
): Promise<ComposedPrompt> {
  const { message } = request
  const text = message.text.trim()
  if (text.length === 0 && message.attachments.length === 0) {
    return refuse("empty", "The message has no text and no attachment.")
  }
  const outcome = planAttachments(deps, request.capability, message.attachments)
  if (!outcome.ok) return outcome
  const { planned } = outcome
  const files = planned.filter((entry) => entry.image === undefined)
  const inbox = files.length === 0 ? undefined : deps.inboxOf(request.botId)
  if (files.length > 0 && inbox === undefined) {
    return refuse("environment-unavailable", "The bot's environment cannot take files right now.")
  }

  const read = new Map<Planned, Uint8Array>()
  for (const entry of planned) {
    try {
      const data = await entry.attachment.read(entry.limit, signal)
      if (data.byteLength > entry.limit)
        throw new Error(`it is larger than ${formatBytes(entry.limit)}`)
      read.set(entry, data)
    } catch (error) {
      signal.throwIfAborted()
      return refuse(
        "unreadable",
        `${quote(entry.attachment.name)} could not be read: ${messageOf(error)}`,
      )
    }
  }
  const actual = planAttachments(
    deps,
    request.capability,
    planned.map((entry) => ({
      ...entry.attachment,
      bytes: (read.get(entry) as Uint8Array).byteLength,
    })),
  )
  if (!actual.ok) return actual

  const saved: { path: string; bytes: number }[] = []
  if (inbox !== undefined) {
    const names = distinctNames(files.map((entry) => sanitizeFileName(entry.attachment.name)))
    try {
      const folder = await inbox.writer.createFolder(
        inbox.root,
        inboxFolderName(message.sentAt, request.source),
        signal,
      )
      for (const [index, entry] of files.entries()) {
        const data = read.get(entry) as Uint8Array
        const path = await inbox.writer.writeFile(folder, names[index] as string, data, signal)
        saved.push({ path, bytes: data.byteLength })
      }
    } catch (error) {
      signal.throwIfAborted()
      return refuse(
        "save-failed",
        `The files could not be saved in the bot's workspace: ${messageOf(error)}`,
      )
    }
  }

  const body = [text, ...(saved.length === 0 ? [] : [savedText(saved)])]
    .filter((part) => part.length > 0)
    .join("\n\n")
  const images = planned.flatMap((entry): PromptPart[] =>
    entry.image === undefined
      ? []
      : [
          {
            type: "image",
            mediaType: entry.image,
            data: deps.encodeBase64(read.get(entry) as Uint8Array),
            ...(entry.attachment.name === ""
              ? {}
              : { name: sanitizeFileName(entry.attachment.name) }),
          },
        ],
  )
  const lines = [request.header, body].filter(
    (part): part is string => part !== undefined && part.length > 0,
  )
  return {
    ok: true,
    content: [
      ...images,
      ...(lines.length === 0 ? [] : [{ type: "text", text: lines.join("\n") } as const]),
    ],
    images: images.length,
    saved: saved.map((file) => file.path),
  }
}
