/** Runs saves one at a time, in order; a failed save does not stop the next. */
export type SaveQueue = <T>(work: () => Promise<T>) => Promise<T>

export function createSaveQueue(): SaveQueue {
  let chain: Promise<unknown> = Promise.resolve()
  return <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
}
