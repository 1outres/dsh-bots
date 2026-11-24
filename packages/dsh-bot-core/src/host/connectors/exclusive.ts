/** Runs of one key one at a time, in arrival order; others wait (or give up on their signal). */
export interface ExclusiveRuns {
  run<T>(key: string, signal: AbortSignal, work: () => Promise<T>): Promise<T>
}

export function createExclusiveRuns(): ExclusiveRuns {
  const tails = new Map<string, Promise<void>>()
  return {
    async run(key, signal, work) {
      signal.throwIfAborted()
      const previous = tails.get(key) ?? Promise.resolve()
      let release = () => {}
      const mine = new Promise<void>((resolve) => {
        release = resolve
      })
      const tail = previous.then(() => mine)
      tails.set(key, tail)
      try {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => reject(signal.reason)
          signal.addEventListener("abort", onAbort, { once: true })
          previous.then(() => {
            signal.removeEventListener("abort", onAbort)
            resolve()
          })
        })
        return await work()
      } finally {
        release()
        if (tails.get(key) === tail) tails.delete(key)
      }
    },
  }
}
