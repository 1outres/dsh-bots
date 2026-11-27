import type { MainInputSubmission } from "../../shared/main-input"

export type DraftAttachmentStatus =
  | { readonly kind: "uploading"; readonly sent: number }
  | { readonly kind: "ready"; readonly attachmentId: string }
  | { readonly kind: "failed"; readonly message: string }

export interface DraftAttachment {
  readonly key: string
  readonly name: string
  readonly mediaType: string
  readonly bytes: number
  readonly preview?: string
  readonly status: DraftAttachmentStatus
}

export interface MainDraft {
  readonly text: string
  readonly attachments: readonly DraftAttachment[]
}

export const EMPTY_DRAFT: MainDraft = { text: "", attachments: [] }

export type Sendable =
  | { readonly ok: true; readonly submission: MainInputSubmission }
  | { readonly ok: false; readonly reason: "empty" | "uploading" | "failed" }

export const withText = (draft: MainDraft, text: string): MainDraft => ({ ...draft, text })

export const withAttachments = (
  draft: MainDraft,
  added: readonly DraftAttachment[],
): MainDraft => ({ ...draft, attachments: [...draft.attachments, ...added] })

const updated = (draft: MainDraft, key: string, status: DraftAttachmentStatus): MainDraft => ({
  ...draft,
  attachments: draft.attachments.map((attachment) =>
    attachment.key === key ? { ...attachment, status } : attachment,
  ),
})

export const uploadProgressed = (draft: MainDraft, key: string, sent: number): MainDraft =>
  updated(draft, key, { kind: "uploading", sent })

export const uploadStaged = (draft: MainDraft, key: string, attachmentId: string): MainDraft =>
  updated(draft, key, { kind: "ready", attachmentId })

export const uploadFailed = (draft: MainDraft, key: string, message: string): MainDraft =>
  updated(draft, key, { kind: "failed", message })

export const withoutAttachment = (draft: MainDraft, key: string): MainDraft => ({
  ...draft,
  attachments: draft.attachments.filter((attachment) => attachment.key !== key),
})

export function sendableOf(draft: MainDraft): Sendable {
  const text = draft.text.trim()
  if (text.length === 0 && draft.attachments.length === 0) return { ok: false, reason: "empty" }
  if (draft.attachments.some((attachment) => attachment.status.kind === "failed")) {
    return { ok: false, reason: "failed" }
  }
  const attachments: string[] = []
  for (const attachment of draft.attachments) {
    if (attachment.status.kind !== "ready") return { ok: false, reason: "uploading" }
    attachments.push(attachment.status.attachmentId)
  }
  return { ok: true, submission: { text, attachments } }
}

export const isImage = (attachment: Pick<DraftAttachment, "mediaType">) =>
  attachment.mediaType.startsWith("image/")
