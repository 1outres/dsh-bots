/**
 * Pinned notes (docs/specs/bot-notes.md §6): their bodies, links shown by
 * title, are in every conversation's context, within one limit for all of
 * them, counted in characters as shown.
 */
import { characters, groupDigits } from "./names"
import type { Note, NoteType } from "./note"

export const PINNED_LIMIT = 4000

export interface PinnedNote {
  readonly id: string
  readonly title: string
  readonly type: NoteType
  /** The note's block in the context. */
  readonly block: string
  /** Characters of {@link block}. */
  readonly size: number
}

/** The pinned notes of `notes` (in id order, which is creation order), shown with `show`. */
export function pinnedNotes(
  notes: Iterable<readonly [string, Note]>,
  show: (body: string) => string,
): readonly PinnedNote[] {
  return [...notes]
    .filter(([, note]) => note.pinned)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, note]) => {
      const body = show(note.body)
      const block =
        body === "" ? `## ${note.title} (${note.type})` : `## ${note.title} (${note.type})\n${body}`
      return { id, title: note.title, type: note.type, block, size: characters(block) }
    })
}

export const pinnedSize = (pinned: readonly PinnedNote[]) =>
  pinned.reduce((sum, note) => sum + note.size, 0)

export const pinnedUsage = (size: number) =>
  `Pinned notes: ${groupDigits(size)} / ${groupDigits(PINNED_LIMIT)} characters.`

/** The context's text: empty while nothing is pinned. */
export function renderPinned(pinned: readonly PinnedNote[]): string {
  if (pinned.length === 0) return ""
  const size = pinnedSize(pinned)
  return [
    "Pinned notes (always loaded; edit them with note_write):",
    ...pinned.map((note) => note.block),
    ...(size > PINNED_LIMIT
      ? [
          `(These take ${groupDigits(size)} of ${groupDigits(PINNED_LIMIT)} characters: shorten them or unpin one.)`,
        ]
      : []),
  ].join("\n")
}
