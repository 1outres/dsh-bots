export interface Limiter {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>
}

export function createLimiter(size: number): Limiter {
  if (!Number.isInteger(size) || size < 1)
    throw new Error(`limit must be a positive integer: ${size}`)
  let active = 0
  const waiting: Array<() => void> = []

  const acquire = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      signal?.throwIfAborted()
      if (active < size) {
        active++
        resolve()
        return
      }
      const grant = () => {
        signal?.removeEventListener("abort", abort)
        active++
        resolve()
      }
      const abort = () => {
        const index = waiting.indexOf(grant)
        if (index >= 0) waiting.splice(index, 1)
        reject(signal?.reason)
      }
      waiting.push(grant)
      signal?.addEventListener("abort", abort, { once: true })
    })

  const release = () => {
    active--
    waiting.shift()?.()
  }

  return {
    async run(task, signal) {
      await acquire(signal)
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}
