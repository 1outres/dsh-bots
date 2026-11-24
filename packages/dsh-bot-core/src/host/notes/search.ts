/**
 * How notes are searched (docs/specs/bot-notes.md §4 note_search, and the
 * notes screen): the query, folded with NFKC and case, as a substring of a
 * title or an alias, of the summary, or of a body line with its links shown
 * by title. Title and alias matches come first, the rest after, each in
 * creation order.
 */
import { foldName } from "../text-fold"
import type { NoteCatalog } from "./catalog"
import type { NoteType } from "./note"

export interface NoteMatch {
  readonly id: string
  /** The title or an alias matched. */
  readonly named: boolean
  /** Indexes of the body lines that match. */
  readonly lines: readonly number[]
}

export function searchNotes(
  catalog: NoteCatalog,
  query: string,
  type: NoteType | undefined,
): readonly NoteMatch[] {
  const folded = foldName(query)
  const named: NoteMatch[] = []
  const others: NoteMatch[] = []
  for (const id of catalog.ids()) {
    const note = catalog.note(id)
    if (note === undefined || (type !== undefined && note.type !== type)) continue
    const lines = catalog
      .shown(note.body)
      .split("\n")
      .flatMap((line, index) => (foldName(line).includes(folded) ? [index] : []))
    if ([note.title, ...note.aliases].some((name) => foldName(name).includes(folded)))
      named.push({ id, named: true, lines })
    else if (lines.length > 0 || foldName(note.summary ?? "").includes(folded))
      others.push({ id, named: false, lines })
  }
  return [...named, ...others]
}
