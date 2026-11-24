/** A value that changes over time, in the shape `useSyncExternalStore` reads. */
export interface Observable<T> {
  getSnapshot(): T
  subscribe(listener: () => void): () => void
}

/** An {@link Observable} its owner writes. */
export interface Store<T> extends Observable<T> {
  set(next: T): void
  update(change: (current: T) => T): void
}

export type Equality<T> = (a: T, b: T) => boolean

type SnapshotsOf<Sources extends readonly Observable<unknown>[]> = {
  readonly [Index in keyof Sources]: Sources[Index] extends Observable<infer Value> ? Value : never
}

function createListeners() {
  const listeners = new Set<() => void>()
  return {
    add(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    notify() {
      for (const listener of [...listeners]) listener()
    },
  }
}

/** A value that never changes. */
export function constant<T>(value: T): Observable<T> {
  return { getSnapshot: () => value, subscribe: () => () => {} }
}

/** A writable value; listeners hear only changes that `equals` tells apart. */
export function createStore<T>(initial: T, equals: Equality<T> = Object.is): Store<T> {
  let current = initial
  const listeners = createListeners()
  const set = (next: T) => {
    if (equals(current, next)) return
    current = next
    listeners.notify()
  }
  return {
    getSnapshot: () => current,
    subscribe: listeners.add,
    set,
    update: (change) => set(change(current)),
  }
}

/**
 * A value computed from `sources`. It is recomputed only when a source's
 * snapshot changes, and keeps its previous snapshot while `equals` holds, so
 * readers see a stable reference.
 */
export function derive<const Sources extends readonly Observable<unknown>[], T>(
  sources: Sources,
  compute: (...values: SnapshotsOf<Sources>) => T,
  equals: Equality<T> = Object.is,
): Observable<T> {
  let cache: { readonly inputs: readonly unknown[]; readonly value: T } | undefined
  const read = (): T => {
    const inputs = sources.map((source) => source.getSnapshot())
    if (
      cache !== undefined &&
      inputs.every((input, index) => Object.is(input, cache?.inputs[index]))
    ) {
      return cache.value
    }
    const computed = compute(...(inputs as SnapshotsOf<Sources>))
    const value = cache !== undefined && equals(cache.value, computed) ? cache.value : computed
    cache = { inputs, value }
    return value
  }
  return {
    getSnapshot: read,
    subscribe(listener) {
      let last = read()
      const changed = () => {
        const next = read()
        if (Object.is(next, last)) return
        last = next
        listener()
      }
      const offs = sources.map((source) => source.subscribe(changed))
      return () => {
        for (const off of offs) off()
      }
    },
  }
}
