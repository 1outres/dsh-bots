/**
 * Run tasks one after another per key; tasks for different keys run
 * concurrently. A failed task does not block the next one.
 */
export interface Serializer {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
}

export function createSerializer(): Serializer {
  const tails = new Map<string, Promise<unknown>>()
  return {
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve()
      const result = previous.then(task, task)
      const tail = result.then(
        () => undefined,
        () => undefined,
      )
      tails.set(key, tail)
      void tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key)
      })
      return result
    },
  }
}
