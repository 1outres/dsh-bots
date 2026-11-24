/** How notes read in tool results and notices (docs/specs/bot-notes.md §4, §5). */
import type { NoteCatalog } from "./catalog"
import { MISSING_NOTE } from "./links"
import type { Suggestion } from "./matching"

/** `Title (type — summary)`, or `Title (type)` for a note without a summary. */
export function describeNote(catalog: NoteCatalog, id: string): string {
  const note = catalog.note(id)
  if (note === undefined) return MISSING_NOTE
  return note.summary === undefined
    ? `${note.title} (${note.type})`
    : `${note.title} (${note.type} — ${note.summary})`
}

export const describeNotes = (catalog: NoteCatalog, ids: readonly string[]) =>
  ids.map((id) => describeNote(catalog, id)).join(" | ")

export const SUGGESTIONS_LEAD =
  "These words match existing notes. If you meant that note, link it with note_link; if not, leave it."

export function suggestionLine(catalog: NoteCatalog, suggestion: Suggestion): string {
  const { target } = suggestion
  const where =
    target.kind === "notes"
      ? describeNotes(catalog, target.ids)
      : catalog.titled(target.title) === undefined
        ? `${target.title} (daily, will be created)`
        : `${target.title} (daily)`
  return `- ${suggestion.label} "${suggestion.text}" → ${where}`
}

export function suggestionsText(
  catalog: NoteCatalog,
  suggestions: readonly Suggestion[],
): readonly string[] {
  return suggestions.length === 0
    ? []
    : [SUGGESTIONS_LEAD, ...suggestions.map((s) => suggestionLine(catalog, s))]
}

/** What note_read shows (§4). */
export function renderNote(catalog: NoteCatalog, id: string): string {
  const note = catalog.note(id)
  if (note === undefined) throw new Error(`note ${id} is not in the catalog`)
  const marks = [
    note.type,
    ...(note.aliases.length === 0 ? [] : [`aliases: ${note.aliases.join(", ")}`]),
    ...(note.pinned ? ["pinned"] : []),
  ]
  const body = catalog.shown(note.body)
  const links = catalog.links(id).filter((target) => target !== id)
  const backlinks = catalog.backlinks(id)
  return [
    `# ${note.title}  (${marks.join("; ")})`,
    ...(note.summary === undefined ? [] : [note.summary]),
    "",
    body === "" ? "(no text yet)" : body,
    "",
    links.length === 0 ? "Links: none" : "Links:",
    ...links.map((target) =>
      catalog.note(target) === undefined
        ? `- ${MISSING_NOTE}: a link points at a note that no longer exists`
        : `- ${describeNote(catalog, target)}`,
    ),
    backlinks.length === 0 ? "Backlinks: none" : "Backlinks:",
    ...backlinks.map((link) => {
      const from = catalog.note(link.from)
      return `- ${from?.title ?? MISSING_NOTE} (${from?.type ?? "?"}): ${JSON.stringify(link.line)}`
    }),
  ].join("\n")
}

/** Files of the notes directory the catalog could not read, for a result's end. */
export function invalidText(catalog: NoteCatalog): readonly string[] {
  return catalog.invalid.length === 0
    ? []
    : [
        "These files in notes/ are not valid notes (fix or remove them):",
        ...catalog.invalid.map((entry) => `- ${entry.file}: ${entry.problem}`),
      ]
}
