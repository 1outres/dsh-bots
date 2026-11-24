import type { SessionEventLike } from "./feed"

/** One file `present` declared: its absolute path in the bot's environment, and its description. */
export interface PresentedFile {
  readonly path: string
  readonly description?: string
}

/** dsh-tool-present's `deliverables/presented` event data, as far as read here. */
export interface Presentation {
  readonly turn: number
  readonly files: readonly PresentedFile[]
}

export const PRESENTED_EVENT = "deliverables/presented"

/** The files a session log event presents, if it is a presentation. */
export function presentationOf(event: SessionEventLike): Presentation | undefined {
  if (event.type !== PRESENTED_EVENT) return undefined
  const data = event.data as Presentation
  return {
    turn: data.turn,
    files: data.files.map((file) => {
      const description = file.description?.trim()
      return description === undefined || description === ""
        ? { path: file.path }
        : { path: file.path, description }
    }),
  }
}

/**
 * The files each session's running turn presented for its channels. A path
 * is kept once, at its first presentation, with the description of its
 * latest one (none when that one has none). Held in memory only.
 */
export interface PresentedFiles {
  record(sessionId: string, presentation: Presentation): void
  /** The turn's files, in order of first presentation; the session's collection is forgotten. */
  take(sessionId: string, turn: number): readonly PresentedFile[]
  /** Forget what the session collected (a turn started, or ended with nothing to send). */
  forget(sessionId: string): void
}

export function createPresentedFiles(): PresentedFiles {
  const collected = new Map<
    string,
    { readonly turn: number; readonly files: Map<string, PresentedFile> }
  >()
  return {
    record(sessionId, presentation) {
      let current = collected.get(sessionId)
      if (current?.turn !== presentation.turn) {
        current = { turn: presentation.turn, files: new Map() }
        collected.set(sessionId, current)
      }
      for (const file of presentation.files) current.files.set(file.path, file)
    },
    take(sessionId, turn) {
      const current = collected.get(sessionId)
      collected.delete(sessionId)
      return current?.turn === turn ? [...current.files.values()] : []
    },
    forget(sessionId) {
      collected.delete(sessionId)
    },
  }
}
