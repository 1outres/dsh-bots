import type { NoteEntry, NoteType } from "../../shared/notes"
import { NOTE_TYPES } from "../../shared/notes"
import type { NoteLinkRenderer } from "../files/MarkdownView"
import type { Translate } from "../types"
import { Tag } from "../ui"
import type { NoteFailure } from "./client"

export const typeLabel = (t: Translate, type: NoteType) => t(`notes.type.${type}`)

export function TypeTag({ t, type }: { readonly t: Translate; readonly type: NoteType }) {
  return <Tag marks={{ "data-dshb-note-type": type }}>{typeLabel(t, type)}</Tag>
}

export const TYPE_FILTERS: readonly ("all" | NoteType)[] = ["all", ...NOTE_TYPES]

export function failureText(t: Translate, failure: NoteFailure): string {
  switch (failure.kind) {
    case "connection":
      return t("notes.error.connection", { message: failure.message })
    case "protocol":
      return t("notes.error.protocol")
    case "host":
      switch (failure.code) {
        case "bot-note/not-bot-session":
          return t("notes.error.not-bot-session")
        case "bot-note/unavailable":
          return t("notes.error.unavailable", { message: failure.message })
        case "bot-note/not-found":
          return t("notes.error.not-found")
        case "gateway/bad-request":
          return t("notes.error.bad-request")
      }
  }
}

/** Note links as words only (inside a row that is itself a button), a missing one marked. */
export function linkText(
  t: Translate,
  targets: Readonly<Record<string, NoteEntry>>,
): NoteLinkRenderer {
  return (link) => {
    const target = targets[link.target]
    return (
      <span
        className="dshb-notes-link"
        data-missing={target === undefined ? "" : undefined}
        title={target === undefined ? t("notes.missing.title") : target.title}
      >
        {link.text ?? target?.title ?? t("notes.missing")}
      </span>
    )
  }
}

/** Note links that open their note, a missing one marked and inert. */
export function linkButtons(
  t: Translate,
  targets: Readonly<Record<string, NoteEntry>>,
  open: (noteId: string) => void,
): NoteLinkRenderer {
  const inert = linkText(t, targets)
  return (link) => {
    const target = targets[link.target]
    if (target === undefined) return inert(link)
    return (
      <button
        type="button"
        className="dshb-notes-link"
        title={target.title}
        data-dshb-note-link={target.id}
        onClick={() => open(target.id)}
      >
        {link.text ?? target.title}
      </button>
    )
  }
}
