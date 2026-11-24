/**
 * The state of one bot session's notes screen, apart from React: what it
 * shows (the list or the calendar, the search, the type, the month, and the
 * notes opened from there) and the queries that show it, run again whenever
 * the bot's notes change (the status's revision).
 */
import type { NoteDocument, NoteListing, NoteMonth, NoteType } from "../../shared/notes"
import type { Timers } from "../files/search-model"
import { createStore, type Observable } from "../observable"
import type { NotesClient } from "./client"
import { createLoader, type Loader } from "./loader"

export type NotesTab = "list" | "calendar"

export interface NotesNavigation {
  readonly tab: NotesTab
  /** The search as typed. */
  readonly query: string
  readonly type: NoteType | undefined
  /** The calendar's month, `YYYY-MM`; undefined for today's in the bot's time zone. */
  readonly month: string | undefined
  /** The notes opened, the last one shown; empty shows the tab. */
  readonly trail: readonly string[]
}

export const NOTE_SEARCH_DELAY_MS = 250

const INITIAL: NotesNavigation = {
  tab: "list",
  query: "",
  type: undefined,
  month: undefined,
  trail: [],
}

export interface NotesModel {
  readonly navigation: Observable<NotesNavigation>
  readonly status: ReturnType<NotesClient["status"]>
  readonly listing: Loader<NoteListing>
  readonly document: Loader<NoteDocument>
  readonly month: Loader<NoteMonth>
  setTab(tab: NotesTab): void
  setQuery(query: string): void
  setType(type: NoteType | undefined): void
  showMonth(month: string | undefined): void
  /** Show a note, after the one shown. */
  open(noteId: string): void
  /** Back to the note before, or from the first note to the tab. */
  back(): void
  /** Read the notes again for what is shown. */
  refresh(): void
  /** Follow the notes and run the queries while the screen shows; returns the detach. */
  attach(): () => void
  dispose(): void
}

/** The search a query runs: blank lists the notes. */
const queryKey = (term: string, type: NoteType | undefined) => JSON.stringify([term.trim(), type])

export function createNotesModel(
  client: NotesClient,
  sessionId: string,
  timers: Timers,
): NotesModel {
  const navigation = createStore<NotesNavigation>(INITIAL)
  /** The search after the typing paused. */
  const term = createStore("")
  let pending: unknown
  const status = client.status(sessionId)
  const listing = createLoader<NoteListing>((key, signal) => {
    const [text, type] = JSON.parse(key) as [string, NoteType | null]
    const filter = type === null ? {} : { type }
    return text === ""
      ? client.list(sessionId, filter, signal)
      : client.search(sessionId, { query: text, ...filter }, signal)
  })
  const document = createLoader<NoteDocument>((noteId, signal) =>
    client.read(sessionId, noteId, signal),
  )
  const month = createLoader<NoteMonth>((key, signal) =>
    client.month(sessionId, key === "" ? undefined : key, signal),
  )

  /** The notes' revision while they can be read. */
  const readyRevision = () => {
    const feed = status.getSnapshot()
    return feed.status === "ready" && feed.value.state === "ready" ? feed.value.revision : undefined
  }

  const run = (revision: number, force: boolean) => {
    const shown = navigation.getSnapshot()
    const noteId = shown.trail.at(-1)
    if (noteId !== undefined) document.request(noteId, revision, force)
    else if (shown.tab === "list")
      listing.request(queryKey(term.getSnapshot(), shown.type), revision, force)
    else month.request(shown.month ?? "", revision, force)
  }

  const sync = () => {
    const revision = readyRevision()
    if (revision !== undefined) run(revision, false)
  }

  const change = (next: Partial<NotesNavigation>) =>
    navigation.update((current) => ({ ...current, ...next }))

  const cancelPending = () => {
    if (pending === undefined) return
    timers.clear(pending)
    pending = undefined
  }

  let attached = 0
  let detachAll: (() => void) | undefined

  return {
    navigation,
    status,
    listing,
    document,
    month,
    setTab: (tab) => change({ tab, trail: [] }),
    setQuery(query) {
      change({ query, trail: [] })
      cancelPending()
      if (query.trim() === "") term.set("")
      else
        pending = timers.set(() => {
          pending = undefined
          term.set(query)
        }, NOTE_SEARCH_DELAY_MS)
    },
    setType: (type) => change({ type, trail: [] }),
    showMonth: (shownMonth) => change({ month: shownMonth, trail: [] }),
    open: (noteId) =>
      navigation.update((current) =>
        current.trail.at(-1) === noteId
          ? current
          : { ...current, trail: [...current.trail, noteId] },
      ),
    back: () => navigation.update((current) => ({ ...current, trail: current.trail.slice(0, -1) })),
    /** While the notes cannot be read, this asks for them again: a reading that succeeds makes the Host's status ready. */
    refresh: () => run(readyRevision() ?? 0, true),
    attach() {
      attached += 1
      if (attached === 1) {
        const offs = [
          status.subscribe(() => sync()),
          navigation.subscribe(() => sync()),
          term.subscribe(() => sync()),
        ]
        sync()
        detachAll = () => {
          for (const off of offs) off()
        }
      }
      return () => {
        attached -= 1
        if (attached > 0) return
        detachAll?.()
        detachAll = undefined
      }
    },
    dispose() {
      cancelPending()
      detachAll?.()
      detachAll = undefined
      listing.clear()
      document.clear()
      month.clear()
    },
  }
}
