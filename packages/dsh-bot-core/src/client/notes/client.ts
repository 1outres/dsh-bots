import {
  BOT_NOTE_WIRE_CODES,
  type BotNotesStatus,
  type BotNoteWireCode,
  type NoteDocument,
  type NoteFilter,
  type NoteListing,
  type NoteMonth,
  type NoteSearch,
} from "../../shared/notes"
import type { Observable } from "../observable"
import type { BotNotesRemote, RemoteMount } from "../remote"
import { type FeedState, followed, messageOf, mountedRemote } from "../remote-feed"
import type { RemoteResult } from "../types"

/** Why a `botNotes` call failed in the browser. */
export type NoteFailure =
  | { readonly kind: "host"; readonly code: BotNoteWireCode; readonly message: string }
  /** The call threw: the connection to the Host failed, or the Remote could not be mounted. */
  | { readonly kind: "connection"; readonly message: string }
  /** The Host answered with a code outside the contract. */
  | { readonly kind: "protocol"; readonly message: string }

export class NoteRequestError extends Error {
  override readonly name = "NoteRequestError"
  constructor(readonly failure: NoteFailure) {
    super(failure.message)
  }
}

const isWireCode = (code: unknown): code is BotNoteWireCode =>
  typeof code === "string" && (BOT_NOTE_WIRE_CODES as readonly string[]).includes(code)

const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError"

function unwrapNote<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  const { code, message } = result.error
  if (!isWireCode(code)) {
    console.error("bot-core: botNotes answered outside its contract", result)
    throw new NoteRequestError({
      kind: "protocol",
      message: `unknown failure code ${String(code)}: ${message ?? ""}`,
    })
  }
  throw new NoteRequestError({ kind: "host", code, message: message ?? code })
}

/** The `botNotes` Remote for the browser: a shared status stream per session while anything subscribes, and queries that reject with a {@link NoteRequestError}. */
export interface NotesClient {
  status(sessionId: string): Observable<FeedState<BotNotesStatus>>
  list(sessionId: string, filter: NoteFilter, signal?: AbortSignal): Promise<NoteListing>
  search(sessionId: string, search: NoteSearch, signal?: AbortSignal): Promise<NoteListing>
  read(sessionId: string, noteId: string, signal?: AbortSignal): Promise<NoteDocument>
  month(sessionId: string, month: string | undefined, signal?: AbortSignal): Promise<NoteMonth>
}

export function createNotesClient(mount: Promise<RemoteMount>): NotesClient {
  const notesOf = async (): Promise<BotNotesRemote> => (await mountedRemote(mount)).botNotes
  const feeds = new Map<string, Observable<FeedState<BotNotesStatus>>>()
  const call = async <T>(run: (remote: BotNotesRemote) => Promise<RemoteResult<T>>) => {
    let result: RemoteResult<T>
    try {
      result = await run(await notesOf())
    } catch (error) {
      if (isAbort(error)) throw error
      throw new NoteRequestError({ kind: "connection", message: messageOf(error) })
    }
    return unwrapNote(result)
  }
  return {
    status(sessionId) {
      let feed = feeds.get(sessionId)
      if (feed === undefined) {
        feed = followed((remote: BotNotesRemote) => remote.watch(sessionId), notesOf)
        feeds.set(sessionId, feed)
      }
      return feed
    },
    list: (sessionId, filter, signal) => call((remote) => remote.list(sessionId, filter, signal)),
    search: (sessionId, search, signal) =>
      call((remote) => remote.search(sessionId, search, signal)),
    read: (sessionId, noteId, signal) => call((remote) => remote.read(sessionId, noteId, signal)),
    month: (sessionId, month, signal) => call((remote) => remote.month(sessionId, month, signal)),
  }
}
