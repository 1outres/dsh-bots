import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import {
  type BotNoteErrorDetails,
  type BotNotesStatus,
  NOTE_HIT_LINES,
  NOTE_TYPES,
  type NoteDocument,
  type NoteEntry,
  type NoteFilter,
  type NoteListing,
  type NoteMonth,
  type NoteSearch,
  type NoteType,
} from "../../shared/notes"
import type { BotNotes } from "./bot-notes"
import type { NoteCatalog } from "./catalog"
import { linksIn, plainLinks } from "./links"
import type { NotesPlace, NotesView } from "./notebook"
import { PINNED_LIMIT, pinnedNotes, pinnedSize } from "./pinned"
import { searchNotes } from "./search"

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap extends BotNoteErrorDetails {}
}

export interface NotesPanelDeps {
  botOfSession(sessionId: string): string | undefined
  placeOf(botId: string): NotesPlace | undefined
  notes: Pick<BotNotes, "withNotes" | "subscribe">
  timeZone(botId: string): string
  today(botId: string): string
  deadline(): AbortSignal
}

export interface NotesPanel {
  botOf(sessionId: string): string
  status(botId: string): BotNotesStatus
  follow(botId: string): () => void
  list(
    sessionId: string,
    filter: NoteFilter | undefined,
    signal?: AbortSignal,
  ): Promise<NoteListing>
  search(sessionId: string, search: NoteSearch, signal?: AbortSignal): Promise<NoteListing>
  read(sessionId: string, noteId: string, signal?: AbortSignal): Promise<NoteDocument>
  month(sessionId: string, month: string | undefined, signal?: AbortSignal): Promise<NoteMonth>
  environmentChanged(botId: string): void
  subscribe(listener: (botId: string) => void): () => void
  dispose(): void
}

export const MAX_NOTE_QUERY = 1024

const ENVIRONMENT_UNAVAILABLE = "the bot's environment is not available"
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/u

type Reading =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly view: NotesView }
  | { readonly state: "unavailable"; readonly message: string }

interface Followed {
  followers: number
  reading: Reading
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const bad = (message: string) => new RemoteError("gateway/bad-request", message, {})

const sameReading = (a: Reading, b: Reading) => {
  if (a.state === "ready" && b.state === "ready") return a.view === b.view
  if (a.state === "unavailable" && b.state === "unavailable") return a.message === b.message
  return a.state === b.state
}

function entryOf(catalog: NoteCatalog, id: string): NoteEntry | undefined {
  const note = catalog.note(id)
  if (note === undefined) return undefined
  return {
    id,
    title: note.title,
    type: note.type,
    aliases: note.aliases,
    ...(note.summary === undefined ? {} : { summary: note.summary }),
    pinned: note.pinned,
  }
}

const requireEntry = (catalog: NoteCatalog, id: string) => entryOf(catalog, id) as NoteEntry

function typeOf(value: unknown): NoteType | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !(NOTE_TYPES as readonly string[]).includes(value))
    throw bad(`type must be one of ${NOTE_TYPES.join(", ")}`)
  return value as NoteType
}

function filterOf(filter: unknown): NoteFilter {
  if (filter === undefined) return {}
  if (typeof filter !== "object" || filter === null) throw bad("filter must be an object")
  const type = typeOf((filter as { type?: unknown }).type)
  return type === undefined ? {} : { type }
}

function searchOf(search: unknown): NoteSearch {
  if (typeof search !== "object" || search === null) throw bad("search must be an object")
  const { query } = search as { query?: unknown }
  if (typeof query !== "string" || query.trim() === "") throw bad("query must not be blank")
  if (query.length > MAX_NOTE_QUERY) throw bad(`query must be at most ${MAX_NOTE_QUERY} characters`)
  return { query, ...filterOf(search) }
}

function statusOf(reading: Reading, revision: number): BotNotesStatus {
  if (reading.state !== "ready") return reading
  const { catalog } = reading.view
  const notes = catalog.ids().flatMap((id) => {
    const note = catalog.note(id)
    return note === undefined ? [] : [[id, note] as const]
  })
  return {
    state: "ready",
    revision,
    count: notes.length,
    pinned: {
      characters: pinnedSize(pinnedNotes(notes, catalog.shown)),
      limit: PINNED_LIMIT,
    },
    invalid: catalog.invalid,
  }
}

export function createNotesPanel(deps: NotesPanelDeps): NotesPanel {
  const followed = new Map<string, Followed>()
  const revisions = new Map<string, number>()
  const refreshing = new Map<string, Promise<void>>()
  const listeners = new Set<(botId: string) => void>()
  const publish = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  const revisionOf = (botId: string) => revisions.get(botId) ?? 0

  const botOf = (sessionId: unknown): string => {
    if (typeof sessionId !== "string" || sessionId === "") throw bad("sessionId is required")
    const botId = deps.botOfSession(sessionId)
    if (botId === undefined) {
      throw new RemoteError(
        "bot-note/not-bot-session",
        `session ${JSON.stringify(sessionId)} is not a session of a bot`,
        { sessionId },
      )
    }
    return botId
  }

  const record = (botId: string, reading: Reading) => {
    const entry = followed.get(botId)
    if (entry === undefined || sameReading(entry.reading, reading)) return
    entry.reading = reading
    publish(botId)
  }

  const load = async (
    botId: string,
    sessionId: string,
    signal: AbortSignal | undefined,
  ): Promise<NotesView> => {
    const place = deps.placeOf(botId)
    const unavailable = (message: string) => {
      record(botId, { state: "unavailable", message })
      return new RemoteError("bot-note/unavailable", message, { sessionId })
    }
    if (place === undefined) throw unavailable(ENVIRONMENT_UNAVAILABLE)
    const deadline = deps.deadline()
    const combined = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    let view: NotesView
    try {
      view = await deps.notes.withNotes(botId, (state) => state.notebook.load(place, combined))
    } catch (error) {
      signal?.throwIfAborted()
      throw unavailable(messageOf(error))
    }
    record(botId, { state: "ready", view })
    return view
  }

  const refresh = (botId: string): Promise<void> => {
    const running = refreshing.get(botId)
    if (running !== undefined) return running.then(() => refresh(botId))
    const work = load(botId, "", undefined)
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        if (refreshing.get(botId) === work) refreshing.delete(botId)
      })
    refreshing.set(botId, work)
    return work
  }

  const off = deps.notes.subscribe((botId) => {
    revisions.set(botId, revisionOf(botId) + 1)
    if (followed.has(botId)) void refresh(botId)
  })

  const viewFor = async (sessionId: string, signal: AbortSignal | undefined) => {
    const botId = botOf(sessionId)
    const view = await load(botId, sessionId, signal)
    return { botId, view, revision: revisionOf(botId) }
  }

  return {
    botOf,
    status(botId) {
      const entry = followed.get(botId)
      return statusOf(entry?.reading ?? { state: "loading" }, revisionOf(botId))
    },
    follow(botId) {
      const entry = followed.get(botId)
      if (entry === undefined) followed.set(botId, { followers: 1, reading: { state: "loading" } })
      else entry.followers += 1
      void refresh(botId)
      return () => {
        const current = followed.get(botId)
        if (current === undefined) return
        current.followers -= 1
        if (current.followers === 0) followed.delete(botId)
      }
    },
    async list(sessionId, filter, signal) {
      const { type } = filterOf(filter)
      const { view, revision } = await viewFor(sessionId, signal)
      const { catalog } = view
      const notes = [...catalog.ids()]
        .reverse()
        .flatMap((id) => {
          const entry = entryOf(catalog, id)
          return entry === undefined || (type !== undefined && entry.type !== type) ? [] : [entry]
        })
        .map((entry) => ({ ...entry, lines: [] }))
      return { revision, notes }
    },
    async search(sessionId, search, signal) {
      const input = searchOf(search)
      const { view, revision } = await viewFor(sessionId, signal)
      const { catalog } = view
      const titleOf = (id: string) => catalog.note(id)?.title
      const notes = searchNotes(catalog, input.query, input.type).map((match) => {
        const body = (catalog.note(match.id)?.body ?? "").split("\n")
        return {
          ...requireEntry(catalog, match.id),
          lines: match.named
            ? []
            : match.lines
                .slice(0, NOTE_HIT_LINES)
                .map((index) => plainLinks(body[index] ?? "", titleOf).trim()),
        }
      })
      return { revision, notes }
    },
    async read(sessionId, noteId, signal) {
      if (typeof noteId !== "string" || noteId === "") throw bad("noteId is required")
      const { view, revision } = await viewFor(sessionId, signal)
      const { catalog } = view
      const note = catalog.note(noteId)
      if (note === undefined) {
        throw new RemoteError("bot-note/not-found", `no note has the id ${noteId}`, { noteId })
      }
      const backlinks = catalog.backlinks(noteId).map((link) => ({
        from: requireEntry(catalog, link.from),
        line: link.stored,
      }))
      const targets: Record<string, NoteEntry> = {}
      for (const text of [note.body, ...backlinks.map((link) => link.line)]) {
        for (const link of linksIn(text)) {
          const entry = entryOf(catalog, link.target)
          if (entry !== undefined) targets[link.target] = entry
        }
      }
      return {
        revision,
        note: requireEntry(catalog, noteId),
        body: note.body,
        targets,
        links: catalog
          .links(noteId)
          .filter((target) => target !== noteId)
          .map((target) => {
            const entry = entryOf(catalog, target)
            return entry === undefined
              ? { kind: "missing" as const, id: target }
              : { kind: "note" as const, note: entry }
          }),
        backlinks,
      }
    },
    async month(sessionId, month, signal) {
      if (month !== undefined && (typeof month !== "string" || !MONTH.test(month)))
        throw bad("month must be YYYY-MM")
      const botId = botOf(sessionId)
      const today = deps.today(botId)
      const shown = month ?? today.slice(0, 7)
      const { view, revision } = await viewFor(sessionId, signal)
      const { catalog } = view
      const days = catalog
        .ids()
        .flatMap((id) => {
          const note = catalog.note(id)
          return note?.type === "daily" && note.title.startsWith(`${shown}-`)
            ? [{ date: note.title, id }]
            : []
        })
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      return { revision, month: shown, today, timeZone: deps.timeZone(botId), days }
    },
    environmentChanged(botId) {
      if (followed.has(botId)) void refresh(botId)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose: off,
  }
}
