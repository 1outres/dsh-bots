import { createStore, type Observable } from "./observable"

export interface PersistentValueOptions<T> {
  /** The localStorage key. */
  readonly key: string
  /** The stored JSON's value; throws when the stored value is not a `T`. */
  readonly parse: (stored: unknown) => T
  /** The value while nothing usable is stored. */
  readonly initial: T
}

/** A value kept in localStorage as JSON, read once and written on every change. */
export interface PersistentValue<T> extends Observable<T> {
  set(next: T): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function once(warning: string): (cause: unknown) => void {
  let warned = false
  return (cause) => {
    if (warned) return
    warned = true
    console.warn(`bot-core: ${warning}: ${messageOf(cause)}`)
  }
}

function storage(): Storage {
  if (typeof localStorage === "undefined") throw new Error("localStorage is not available")
  return localStorage
}

/**
 * A localStorage-backed value. A missing entry reads as `initial`; storage
 * that is absent, throws or holds an unparsable value also reads as
 * `initial` and warns once, and a failed write warns once while the value
 * still changes for this page.
 */
export function createPersistentValue<T>(options: PersistentValueOptions<T>): PersistentValue<T> {
  const { key, parse, initial } = options
  const readFailed = once(`reading "${key}" from localStorage failed; using the default`)
  const writeFailed = once(`writing "${key}" to localStorage failed; it lasts until reload`)

  const load = (): T => {
    try {
      const stored = storage().getItem(key)
      return stored === null ? initial : parse(JSON.parse(stored))
    } catch (error) {
      readFailed(error)
      return initial
    }
  }

  const value = createStore(load())
  return {
    getSnapshot: value.getSnapshot,
    subscribe: value.subscribe,
    set(next) {
      if (Object.is(value.getSnapshot(), next)) return
      value.set(next)
      try {
        storage().setItem(key, JSON.stringify(next))
      } catch (error) {
        writeFailed(error)
      }
    },
  }
}
