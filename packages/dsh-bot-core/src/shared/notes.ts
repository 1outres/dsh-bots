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

export interface NoteEntry {
  readonly id: string
  readonly title: string
  readonly type: NoteType
  readonly aliases: readonly string[]
  readonly summary?: string
  readonly pinned: boolean
}

export interface InvalidNoteFile {
  readonly file: string
  readonly problem: string
}

export type BotNotesStatus =
  | { readonly state: "loading" }
  | {
      readonly state: "ready"
      readonly revision: number
      readonly count: number
      readonly pinned: { readonly characters: number; readonly limit: number }
      readonly invalid: readonly InvalidNoteFile[]
    }
  | { readonly state: "unavailable"; readonly message: string }

export interface NoteFilter {
  readonly type?: NoteType
}

export interface NoteSearch extends NoteFilter {
  readonly query: string
}

export interface NoteHit extends NoteEntry {
  readonly lines: readonly string[]
}

export interface NoteListing {
  readonly revision: number
  readonly notes: readonly NoteHit[]
}

export const NOTE_HIT_LINES = 2

export type NoteLink =
  | { readonly kind: "note"; readonly note: NoteEntry }
  | { readonly kind: "missing"; readonly id: string }

export interface NoteBacklink {
  readonly from: NoteEntry
  readonly line: string
}

export interface NoteDocument {
  readonly revision: number
  readonly note: NoteEntry
  readonly body: string
  readonly targets: Readonly<Record<string, NoteEntry>>
  readonly links: readonly NoteLink[]
  readonly backlinks: readonly NoteBacklink[]
}

export interface NoteMonth {
  readonly revision: number
  readonly month: string
  readonly today: string
  readonly timeZone: string
  readonly days: readonly { readonly date: string; readonly id: string }[]
}

export const BOT_NOTE_ERROR_CODES = [
  "bot-note/not-bot-session",
  "bot-note/unavailable",
  "bot-note/not-found",
] as const

export type BotNoteErrorCode = (typeof BOT_NOTE_ERROR_CODES)[number]

export const BOT_NOTE_WIRE_CODES = [...BOT_NOTE_ERROR_CODES, "gateway/bad-request"] as const

export type BotNoteWireCode = (typeof BOT_NOTE_WIRE_CODES)[number]

export interface BotNoteErrorDetails {
  readonly "bot-note/not-bot-session": { readonly sessionId: string }
  readonly "bot-note/unavailable": { readonly sessionId: string }
  readonly "bot-note/not-found": { readonly noteId: string }
}

export interface BotNotesApi {
  watch(sessionId: string, signal?: AbortSignal): AsyncIterable<BotNotesStatus>
  list(sessionId: string, filter?: NoteFilter, signal?: AbortSignal): Promise<NoteListing>
  search(sessionId: string, search: NoteSearch, signal?: AbortSignal): Promise<NoteListing>
  read(sessionId: string, noteId: string, signal?: AbortSignal): Promise<NoteDocument>
  month(sessionId: string, month?: string, signal?: AbortSignal): Promise<NoteMonth>
}
