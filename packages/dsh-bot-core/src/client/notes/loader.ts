import { createStore, type Observable } from "../observable"
import { type NoteFailure, NoteRequestError } from "./client"

/** One query's result; a reload of the same query keeps the value it replaces. */
export type Load<T> =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly previous?: T }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "failed"; readonly failure: NoteFailure }

/** The value a load shows: the result, or while reloading the one before. */
export function shownValue<T>(load: Load<T>): T | undefined {
  if (load.status === "ready") return load.value
  if (load.status === "loading") return load.previous
  return undefined
}

export interface Loader<T> extends Observable<Load<T>> {
  /**
   * Show the result of `key` as of `revision`: loaded again only for
   * another key, a revision newer than the one last read, or `force`.
   */
  request(key: string, revision: number, force?: boolean): void
  /** Forget the result and stop the running load. */
  clear(): void
}

const failureOf = (error: unknown): NoteFailure =>
  error instanceof NoteRequestError
    ? error.failure
    : { kind: "connection", message: error instanceof Error ? error.message : String(error) }

/** A query the notes screen runs, each result read as of the notes' revision it reports. */
export function createLoader<T extends { readonly revision: number }>(
  fetch: (key: string, signal: AbortSignal) => Promise<T>,
): Loader<T> {
  const state = createStore<Load<T>>({ status: "idle" })
  let current: { key: string; revision: number; controller: AbortController } | undefined
  const stop = () => {
    current?.controller.abort()
    current = undefined
  }
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    request(key, revision, force = false) {
      if (current !== undefined && current.key === key && current.revision >= revision && !force)
        return
      const sameKey = current?.key === key
      current?.controller.abort()
      const controller = new AbortController()
      const request = { key, revision, controller }
      current = request
      const previous = sameKey ? shownValue(state.getSnapshot()) : undefined
      state.set(previous === undefined ? { status: "loading" } : { status: "loading", previous })
      fetch(key, controller.signal).then(
        (value) => {
          if (current !== request) return
          request.revision = Math.max(revision, value.revision)
          state.set({ status: "ready", value })
        },
        (error: unknown) => {
          if (current !== request || controller.signal.aborted) return
          state.set({ status: "failed", failure: failureOf(error) })
        },
      )
    },
    clear() {
      stop()
      state.set({ status: "idle" })
    },
  }
}
