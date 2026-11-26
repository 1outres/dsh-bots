import { createStore, type Observable } from "./observable"

export interface PersistentValueOptions<T> {
  readonly key: string
  readonly parse: (stored: unknown) => T
  readonly initial: T
}

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
