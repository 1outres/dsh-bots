/**
 * A bot's notes as the Web UI reads them (docs/specs/bot-notes.md §12): the
 * notes in its workspace's notes/, read through the bot's environment for one
 * of the bot's sessions. Links in a body name their note by id, as the file
 * keeps them.
 */

export const NOTE_TYPES = [
  "person",
  "place",
  "organization",
  "matter",
  "thing",
  "topic",
  "daily",
] as const

export type NoteType = (typeof NOTE_TYPES)[number]

/** One note, without its body. */
export interface NoteEntry {
  readonly id: string
  readonly title: string
  readonly type: NoteType
  readonly aliases: readonly string[]
  /** Absent only on daily notes. */
  readonly summary?: string
  readonly pinned: boolean
}

/** A file of notes/ that is not a valid note, and why. */
export interface InvalidNoteFile {
  /** Relative to the workspace (`notes/<id>.md`). */
  readonly file: string
  readonly problem: string
}

/**
 * Whether the bot's notes can be read now. `revision` changes whenever the
 * notes do (a write of the bot's, an edit with bash, the files read again).
 */
export type BotNotesStatus =
  | { readonly state: "loading" }
  | {
      readonly state: "ready"
      readonly revision: number
      readonly count: number
      /** Characters the pinned notes take in every conversation, and their limit. */
      readonly pinned: { readonly characters: number; readonly limit: number }
      readonly invalid: readonly InvalidNoteFile[]
    }
  | { readonly state: "unavailable"; readonly message: string }

export interface NoteFilter {
  readonly type?: NoteType
}

export interface NoteSearch extends NoteFilter {
  /** Matched as note_search matches it: NFKC and lower case, a substring of a title, an alias, the summary or a body line. */
  readonly query: string
}

/** One note of a listing or a search. */
export interface NoteHit extends NoteEntry {
  /**
   * The body lines that match a search, at most {@link NOTE_HIT_LINES}, each
   * with its links as the text they show; empty for a listing and when the
   * title or an alias matched.
   */
  readonly lines: readonly string[]
}

export interface NoteListing {
  readonly revision: number
  /** A listing: newest first. A search: title and alias matches first, then the rest, each in creation order. */
  readonly notes: readonly NoteHit[]
}

/** Matching body lines a hit carries. */
export const NOTE_HIT_LINES = 2

/** Where a note links to: a note, or an id no note has. */
export type NoteLink =
  | { readonly kind: "note"; readonly note: NoteEntry }
  | { readonly kind: "missing"; readonly id: string }

export interface NoteBacklink {
  readonly from: NoteEntry
  /** The linking line as the file keeps it (links by id), trimmed. */
  readonly line: string
}

export interface NoteDocument {
  readonly revision: number
  readonly note: NoteEntry
  /** The body as the file keeps it: `[[<id>]]` and `[[<id>|text]]` links. */
  readonly body: string
  /** Every existing note the body and the backlink lines link to, by id; an id it lacks is a missing note. */
  readonly targets: Readonly<Record<string, NoteEntry>>
  /** Distinct notes the body links to, in order of their first link, itself left out. */
  readonly links: readonly NoteLink[]
  readonly backlinks: readonly NoteBacklink[]
}

/** The daily notes of one month. */
export interface NoteMonth {
  readonly revision: number
  /** `YYYY-MM`. */
  readonly month: string
  /** Today in the bot's time zone, `YYYY-MM-DD`. */
  readonly today: string
  readonly timeZone: string
  /** Each day of the month that has a daily note, in order. */
  readonly days: readonly { readonly date: string; readonly id: string }[]
}

/** Every `bot-note/…` failure code the Host's `botNotes` raises. */
export const BOT_NOTE_ERROR_CODES = [
  "bot-note/not-bot-session",
  "bot-note/unavailable",
  "bot-note/not-found",
] as const

export type BotNoteErrorCode = (typeof BOT_NOTE_ERROR_CODES)[number]

/** Every code a `botNotes` result carries: the Host's own and the refusal of malformed arguments. */
export const BOT_NOTE_WIRE_CODES = [...BOT_NOTE_ERROR_CODES, "gateway/bad-request"] as const

export type BotNoteWireCode = (typeof BOT_NOTE_WIRE_CODES)[number]

export interface BotNoteErrorDetails {
  readonly "bot-note/not-bot-session": { readonly sessionId: string }
  readonly "bot-note/unavailable": { readonly sessionId: string }
  readonly "bot-note/not-found": { readonly noteId: string }
}

/**
 * The `botNotes` Remote: read-only. Every method names one of the bot's
 * sessions and is answered only for a session bot-core recorded as a stored
 * bot's, with that bot's notes; every query reads notes/ again first.
 */
export interface BotNotesApi {
  /** Whether the notes can be read, now and after every change, while watched. */
  watch(sessionId: string, signal?: AbortSignal): AsyncIterable<BotNotesStatus>
  list(sessionId: string, filter?: NoteFilter, signal?: AbortSignal): Promise<NoteListing>
  search(sessionId: string, search: NoteSearch, signal?: AbortSignal): Promise<NoteListing>
  /** @throws `bot-note/not-found` when no note has the id. */
  read(sessionId: string, noteId: string, signal?: AbortSignal): Promise<NoteDocument>
  /** The daily notes of `month` (`YYYY-MM`), by default today's month in the bot's time zone. */
  month(sessionId: string, month?: string, signal?: AbortSignal): Promise<NoteMonth>
}
