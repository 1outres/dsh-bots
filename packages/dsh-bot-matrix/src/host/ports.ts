export interface Scheduler {
  later(ms: number, work: () => void): () => void
}

export function sleep(scheduler: Scheduler, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const cancel = scheduler.later(ms, () => {
      signal.removeEventListener("abort", abort)
      resolve()
    })
    const abort = () => {
      cancel()
      reject(signal.reason)
    }
    signal.addEventListener("abort", abort, { once: true })
  })
}
