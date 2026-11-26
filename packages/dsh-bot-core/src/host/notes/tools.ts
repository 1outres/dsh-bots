import { z } from "zod"
import { foldName } from "../text-fold"
import type { NoteCatalog } from "./catalog"
import { addedRanges } from "./diff"
import { MISSING_NOTE, mapLinks, storedLink } from "./links"
import { nameTable, type Suggestion, suggestLinks } from "./matching"
import { groupDigits } from "./names"
import {
  fieldsProblem,
  isDateTitle,
  NOTE_TYPES,
  type Note,
  type NoteFields,
  nameProblem,
  serializeNote,
} from "./note"
import type { Notebook, NotesPlace, NotesView } from "./notebook"
import { PINNED_LIMIT, pinnedNotes, pinnedSize, pinnedUsage } from "./pinned"
import {
  describeNote,
  describeNotes,
  invalidText,
  renderNote,
  suggestionLine,
  suggestionsText,
} from "./render"
import { searchNotes } from "./search"

export const NOTE_TOOLS = ["note_read", "note_write", "note_link", "note_search"] as const
export type NoteTool = (typeof NOTE_TOOLS)[number]

export class NoteToolError extends Error {
  override readonly name = "NoteToolError"
}

interface SuggestionRecord {
  readonly text: string
  readonly suggestions: readonly Suggestion[]
}

export interface BotNotesState {
  readonly notebook: Notebook
  readonly suggestions: Map<string, SuggestionRecord>
}

export const createNotesState = (notebook: Notebook): BotNotesState => ({
  notebook,
  suggestions: new Map(),
})

export interface NoteToolsDeps {
  newId(): string
}

export const DEFAULT_SEARCH_LIMIT = 10
export const MAX_SEARCH_LIMIT = 50

const name = z.string().trim().min(1)
const typeSchema = z.enum(NOTE_TYPES)
const aliasesSchema = z.array(name)

const readSchema = z.strictObject({ note: name })

const writeSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("create"),
    title: name,
    type: typeSchema,
    summary: z.string().trim().min(1).optional(),
    body: z.string().optional(),
    aliases: aliasesSchema.optional(),
    pinned: z.boolean().optional(),
  }),
  z.strictObject({
    action: z.literal("update"),
    note: name,
    title: name.optional(),
    type: typeSchema.optional(),
    aliases: aliasesSchema.optional(),
    summary: z.string().trim().min(1).optional(),
    pinned: z.boolean().optional(),
    body: z.string().optional(),
    edits: z
      .array(z.strictObject({ old: z.string().min(1), new: z.string() }))
      .min(1)
      .optional(),
  }),
  z.strictObject({ action: z.literal("append"), note: name, text: z.string().trim().min(1) }),
])

const applySchema = z.union([
  z.string().trim().min(1),
  z.strictObject({ id: z.string().trim().min(1), target: name }),
])

const linkSchema = z.strictObject({
  note: name,
  apply: z.union([applySchema, z.array(applySchema).min(1)]),
})

const searchSchema = z.strictObject({
  query: name,
  type: typeSchema.optional(),
  limit: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
})

function parse<T>(schema: z.ZodType<T>, args: unknown): T {
  const result = schema.safeParse(args)
  if (result.success) return result.data
  const issues = result.error.issues.map((issue) =>
    issue.path.length === 0 ? issue.message : `${issue.path.join(".")}: ${issue.message}`,
  )
  throw new NoteToolError(`Invalid arguments: ${issues.join("; ")}`)
}

function similar(catalog: NoteCatalog, wanted: string): readonly string[] {
  const key = foldName(wanted)
  return catalog
    .ids()
    .filter((id) => {
      const note = catalog.note(id)
      return (
        note !== undefined &&
        [note.title, ...note.aliases].some((known) => {
          const folded = foldName(known)
          return folded.includes(key) || key.includes(folded)
        })
      )
    })
    .slice(0, 5)
}

function missingText(catalog: NoteCatalog, wanted: string): string {
  const near = similar(catalog, wanted)
  return [
    `No note has the title "${wanted}" (or it as an alias).`,
    ...(near.length === 0 ? [] : [`Similar: ${describeNotes(catalog, near)}.`]),
    ...invalidText(catalog),
  ].join("\n")
}

function requireNote(catalog: NoteCatalog, wanted: string): string {
  const found = catalog.resolve(wanted)
  if (found.kind === "note") return found.id
  if (found.kind === "ambiguous") {
    throw new NoteToolError(
      `"${wanted}" names several notes: ${describeNotes(catalog, found.ids)}. Name the one you mean by its title.`,
    )
  }
  throw new NoteToolError(missingText(catalog, wanted))
}

const dailyNote = (title: string, body = ""): Note => ({
  title,
  type: "daily",
  aliases: [],
  pinned: false,
  body,
})

function storeText(
  text: string,
  catalog: NoteCatalog,
  dailies: Map<string, string>,
  deps: NoteToolsDeps,
): string {
  const problems: string[] = []
  const stored = mapLinks(text, (link) => {
    const written =
      link.text === undefined ? `[[${link.target}]]` : `[[${link.target}|${link.text}]]`
    const found = catalog.resolve(link.target)
    if (found.kind === "note") {
      const title = (catalog.note(found.id) as Note).title
      return storedLink(
        found.id,
        title,
        link.text ?? (link.target === title ? undefined : link.target),
      )
    }
    if (found.kind === "ambiguous") {
      problems.push(
        `${written}: "${link.target}" names several notes: ${describeNotes(catalog, found.ids)}`,
      )
      return written
    }
    if (isDateTitle(link.target)) {
      const id = dailies.get(link.target) ?? deps.newId()
      dailies.set(link.target, id)
      return storedLink(id, link.target, link.text)
    }
    if (link.target === MISSING_NOTE) {
      problems.push(
        `${written}: this link points at a note that no longer exists; remove it or name another note`,
      )
      return written
    }
    const near = similar(catalog, link.target)
    problems.push(
      `${written}: no note has this title or alias${near.length === 0 ? "" : ` (similar: ${describeNotes(catalog, near)})`}`,
    )
    return written
  })
  if (problems.length > 0) {
    throw new NoteToolError(
      [
        "Not saved: these links do not name exactly one note.",
        ...problems.map((problem) => `- ${problem}`),
        "Link by a note's title (or an alias only one note has); create a missing note first, or write the words without a link.",
      ].join("\n"),
    )
  }
  return stored
}

function titleTaken(catalog: NoteCatalog, title: string, except?: string): string | undefined {
  const key = foldName(title)
  return catalog
    .ids()
    .find((id) => id !== except && foldName((catalog.note(id) as Note).title) === key)
}

function checkFields(fields: NoteFields): void {
  const titleProblem = nameProblem(fields.title)
  if (titleProblem !== undefined) throw new NoteToolError(`The title ${titleProblem}.`)
  const problem = fieldsProblem(fields)
  if (problem !== undefined) throw new NoteToolError(`Not saved: ${problem}.`)
}

interface Change {
  readonly id: string
  readonly note: Note
  readonly mode: "create" | "replace"
  readonly before: string
  readonly dailies: ReadonlyMap<string, string>
  readonly suggestions?: readonly Suggestion[]
}

interface Committed {
  readonly view: NotesView
  readonly suggestions: readonly Suggestion[]
  readonly created: readonly string[]
  readonly pinned: number | undefined
}

export interface NoteTools {
  call(
    state: BotNotesState,
    place: NotesPlace,
    tool: NoteTool,
    args: unknown,
    signal: AbortSignal,
  ): Promise<string>
}

export function createNoteTools(deps: NoteToolsDeps): NoteTools {
  const checkPinned = (catalog: NoteCatalog, change: Change): number | undefined => {
    const before = catalog.note(change.id)
    if (!change.note.pinned && before?.pinned !== true) return undefined
    const titles = new Map<string, string>([...change.dailies].map(([title, id]) => [id, title]))
    titles.set(change.id, change.note.title)
    const show = (body: string) =>
      mapLinks(body, (link) => {
        const title = titles.get(link.target) ?? catalog.note(link.target)?.title
        return title === undefined
          ? `[[${MISSING_NOTE}]]`
          : `[[${title}${link.text === undefined ? "" : `|${link.text}`}]]`
      })
    const notes = new Map(catalog.ids().map((id) => [id, catalog.note(id) as Note] as const))
    const old = pinnedSize(pinnedNotes(notes, catalog.shown))
    notes.set(change.id, change.note)
    const next = pinnedNotes(notes, show)
    const size = pinnedSize(next)
    if (size > PINNED_LIMIT && size > old) {
      throw new NoteToolError(
        [
          `Not saved: pinned notes would take ${groupDigits(size)} of ${groupDigits(PINNED_LIMIT)} characters.`,
          ...next.map(
            (note) =>
              `- ${note.title} (${note.type}): ${groupDigits(note.size)}${note.id === change.id ? " (this write)" : ""}`,
          ),
          "Shorten them, or unpin one (note_write update with pinned: false), then write again.",
        ].join("\n"),
      )
    }
    return change.note.pinned || before?.pinned === true ? size : undefined
  }

  const commit = async (
    state: BotNotesState,
    place: NotesPlace,
    view: NotesView,
    change: Change,
    signal: AbortSignal,
  ): Promise<Committed> => {
    checkFields(change.note)
    const pinned = checkPinned(view.catalog, change)
    let current = view
    const created: string[] = []
    for (const [title, id] of change.dailies) {
      if (current.catalog.titled(title) !== undefined) continue
      current = await state.notebook.write(place, id, dailyNote(title), "create", signal)
      created.push(title)
    }
    current = await state.notebook.write(place, change.id, change.note, change.mode, signal)
    const suggestions =
      change.suggestions ??
      suggestLinks(
        change.note.body,
        addedRanges(change.before, change.note.body),
        nameTable(current.catalog, change.id),
      )
    state.suggestions.set(change.id, { text: current.text(change.id) ?? "", suggestions })
    return { view: current, suggestions, created, pinned }
  }

  const report = (
    lead: string,
    committed: Committed,
    suggestions = suggestionsText(committed.view.catalog, committed.suggestions),
  ) =>
    [
      lead,
      ...(committed.created.length === 0
        ? []
        : [`Created daily notes: ${committed.created.join(", ")}.`]),
      ...suggestions,
      ...(committed.pinned === undefined ? [] : [pinnedUsage(committed.pinned)]),
    ].join("\n")

  const read = async (
    state: BotNotesState,
    place: NotesPlace,
    args: unknown,
    signal: AbortSignal,
  ) => {
    const { note } = parse(readSchema, args)
    const { catalog } = await state.notebook.load(place, signal)
    return renderNote(catalog, requireNote(catalog, note))
  }

  const write = async (
    state: BotNotesState,
    place: NotesPlace,
    args: unknown,
    signal: AbortSignal,
  ) => {
    const input = parse(writeSchema, args)
    const view = await state.notebook.load(place, signal)
    const { catalog } = view
    const dailies = new Map<string, string>()
    switch (input.action) {
      case "create": {
        const taken = titleTaken(catalog, input.title)
        if (taken !== undefined) {
          throw new NoteToolError(
            `A note is already titled "${input.title}": ${describeNote(catalog, taken)}. Update it, or choose another title.`,
          )
        }
        const note: Note = {
          title: input.title,
          type: input.type,
          aliases: input.aliases ?? [],
          ...(input.summary === undefined ? {} : { summary: input.summary }),
          pinned: input.pinned ?? false,
          body: storeText(input.body?.trim() ?? "", catalog, dailies, deps),
        }
        const committed = await commit(
          state,
          place,
          view,
          { id: deps.newId(), note, mode: "create", before: "", dailies },
          signal,
        )
        return report(`Created ${note.title}.`, committed)
      }
      case "update": {
        const id = requireNote(catalog, input.note)
        const current = catalog.note(id) as Note
        if (input.body !== undefined && input.edits !== undefined) {
          throw new NoteToolError("Give either body (the whole new text) or edits, not both.")
        }
        if (input.title !== undefined) {
          const taken = titleTaken(catalog, input.title, id)
          if (taken !== undefined)
            throw new NoteToolError(
              `Another note is already titled "${input.title}": ${describeNote(catalog, taken)}.`,
            )
        }
        let body = current.body
        if (input.body !== undefined) body = storeText(input.body.trim(), catalog, dailies, deps)
        if (input.edits !== undefined) {
          let shown = catalog.shown(current.body)
          for (const [index, edit] of input.edits.entries()) {
            const count = shown.split(edit.old).length - 1
            if (count !== 1) {
              throw new NoteToolError(
                `Not saved: edits[${index}].old appears ${count === 0 ? "nowhere" : `${count} times`} in the note's text; it must appear exactly once (read the note for its current text).`,
              )
            }
            shown = shown.replace(edit.old, () => edit.new)
          }
          body = storeText(shown.trim(), catalog, dailies, deps)
        }
        const summary = input.summary ?? current.summary
        const note: Note = {
          title: input.title ?? current.title,
          type: input.type ?? current.type,
          aliases: input.aliases ?? current.aliases,
          ...(summary === undefined ? {} : { summary }),
          pinned: input.pinned ?? current.pinned,
          body,
        }
        if (serializeNote(note) === view.text(id)) return `No change to ${current.title}.`
        const committed = await commit(
          state,
          place,
          view,
          { id, note, mode: "replace", before: current.body, dailies },
          signal,
        )
        return report(`Saved ${note.title}.`, committed)
      }
      case "append": {
        const text = storeText(input.text, catalog, dailies, deps)
        const found = catalog.resolve(input.note)
        if (found.kind === "missing" && isDateTitle(input.note)) {
          const id = dailies.get(input.note) ?? deps.newId()
          dailies.delete(input.note)
          const committed = await commit(
            state,
            place,
            view,
            { id, note: dailyNote(input.note, text), mode: "create", before: "", dailies },
            signal,
          )
          return report(`Created ${input.note} and wrote to it.`, committed)
        }
        const id = requireNote(catalog, input.note)
        const current = catalog.note(id) as Note
        const note: Note = {
          ...current,
          body: current.body === "" ? text : `${current.body}\n${text}`,
        }
        const committed = await commit(
          state,
          place,
          view,
          { id, note, mode: "replace", before: current.body, dailies },
          signal,
        )
        return report(`Saved ${note.title}.`, committed)
      }
    }
  }

  const link = async (
    state: BotNotesState,
    place: NotesPlace,
    args: unknown,
    signal: AbortSignal,
  ) => {
    const input = parse(linkSchema, args)
    const view = await state.notebook.load(place, signal)
    const { catalog } = view
    const id = requireNote(catalog, input.note)
    const current = catalog.note(id) as Note
    const record = state.suggestions.get(id)
    if (record === undefined || record.text !== view.text(id)) {
      throw new NoteToolError(
        `The suggested links of ${current.title} are no longer valid: the note was written after them (or never suggested any). Link words yourself with [[Title|words]] in note_write; its result suggests links again.`,
      )
    }
    const applies = Array.isArray(input.apply) ? input.apply : [input.apply]
    const dailies = new Map<string, string>()
    const chosen = new Map<
      string,
      { suggestion: Suggestion; replacement: string; target: string }
    >()
    for (const apply of applies) {
      const label = typeof apply === "string" ? apply : apply.id
      const suggestion = record.suggestions.find(
        (entry) => entry.label.toLowerCase() === label.toLowerCase(),
      )
      if (suggestion === undefined) {
        throw new NoteToolError(
          `No suggestion ${label} for ${current.title}; its suggestions are ${record.suggestions.map((s) => s.label).join(", ") || "none"}.`,
        )
      }
      const { target } = suggestion
      if (target.kind === "date") {
        const existing = catalog.titled(target.title)
        const dailyId = existing ?? dailies.get(target.title) ?? deps.newId()
        if (existing === undefined) dailies.set(target.title, dailyId)
        chosen.set(suggestion.label, {
          suggestion,
          replacement: storedLink(dailyId, target.title, suggestion.text),
          target: target.title,
        })
        continue
      }
      const wanted = typeof apply === "string" ? undefined : apply.target
      const targetId =
        wanted === undefined
          ? target.ids.length === 1
            ? target.ids[0]
            : undefined
          : target.ids.find(
              (candidate) => foldName((catalog.note(candidate) as Note).title) === foldName(wanted),
            )
      if (targetId === undefined || catalog.note(targetId) === undefined) {
        throw new NoteToolError(
          wanted === undefined
            ? `${suggestion.label} matches several notes; give { id: "${suggestion.label}", target: "<title>" } with one of: ${describeNotes(catalog, target.ids)}.`
            : `"${wanted}" is not one of the notes ${suggestion.label} matches: ${describeNotes(catalog, target.ids)}.`,
        )
      }
      const title = (catalog.note(targetId) as Note).title
      chosen.set(suggestion.label, {
        suggestion,
        replacement: storedLink(targetId, title, suggestion.text),
        target: title,
      })
    }
    let body = current.body
    const shifts: { at: number; by: number }[] = []
    for (const { suggestion, replacement } of [...chosen.values()].sort(
      (a, b) => b.suggestion.start - a.suggestion.start,
    )) {
      body = body.slice(0, suggestion.start) + replacement + body.slice(suggestion.end)
      shifts.push({
        at: suggestion.end,
        by: replacement.length - (suggestion.end - suggestion.start),
      })
    }
    const shift = (offset: number) =>
      offset +
      shifts.filter((entry) => entry.at <= offset).reduce((sum, entry) => sum + entry.by, 0)
    const remaining = record.suggestions
      .filter((suggestion) => !chosen.has(suggestion.label))
      .map((suggestion) => ({
        ...suggestion,
        start: shift(suggestion.start),
        end: shift(suggestion.end),
      }))
    const committed = await commit(
      state,
      place,
      view,
      {
        id,
        note: { ...current, body },
        mode: "replace",
        before: current.body,
        dailies,
        suggestions: remaining,
      },
      signal,
    )
    const linked = [...chosen.values()]
      .sort((a, b) => a.suggestion.start - b.suggestion.start)
      .map(({ suggestion, target }) => `${suggestion.label} "${suggestion.text}" → ${target}`)
    return report(
      `Linked in ${current.title}: ${linked.join(", ")}.`,
      committed,
      remaining.length === 0
        ? []
        : [
            "Still suggested (same numbers):",
            ...remaining.map((s) => suggestionLine(committed.view.catalog, s)),
          ],
    )
  }

  const search = async (
    state: BotNotesState,
    place: NotesPlace,
    args: unknown,
    signal: AbortSignal,
  ) => {
    const input = parse(searchSchema, args)
    const { catalog } = await state.notebook.load(place, signal)
    const hits = searchNotes(catalog, input.query, input.type).map((match) => {
      const lines = catalog.shown((catalog.note(match.id) as Note).body).split("\n")
      return {
        id: match.id,
        lines: match.named ? [] : match.lines.map((index) => lines[index] as string),
      }
    })
    const limit = input.limit ?? DEFAULT_SEARCH_LIMIT
    const shown = hits.slice(0, limit)
    if (shown.length === 0)
      return [`No notes match "${input.query}".`, ...invalidText(catalog)].join("\n")
    return [
      ...shown.flatMap((hit) => [
        `- ${describeNote(catalog, hit.id)}`,
        ...hit.lines.slice(0, 2).map((line) => `  ${JSON.stringify(line.trim())}`),
      ]),
      ...(hits.length > shown.length
        ? [`(${hits.length - shown.length} more; narrow the query or raise limit)`]
        : []),
      ...invalidText(catalog),
    ].join("\n")
  }

  const handlers: Readonly<Record<NoteTool, typeof read>> = {
    note_read: read,
    note_write: write,
    note_link: link,
    note_search: search,
  }

  return {
    call: (state, place, tool, args, signal) => handlers[tool](state, place, args, signal),
  }
}
