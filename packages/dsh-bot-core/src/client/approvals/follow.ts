import type { Observable } from "../observable"
import type { StreamHandle } from "../types"

const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 30_000
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export interface FollowOptions<T> {
  readonly generation: Observable<object | undefined>
  open(): StreamHandle<T>
  item(value: T): void
  lost(message: string | undefined): void
}

function pause(ms: number, generation: Observable<object | undefined>, since: object | undefined) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      off()
      resolve()
    }
    const timer = setTimeout(done, ms)
    const off = generation.subscribe(() => {
      const current = generation.getSnapshot()
      if (current !== undefined && current !== since) done()
    })
  })
}

export function followStream<T>(options: FollowOptions<T>): () => void {
  let disposed = false
  let stop: (() => void) | undefined
  void (async () => {
    let backoff = BASE_DELAY_MS
    while (!disposed) {
      const attempt = options.generation.getSnapshot()
      let failure: string | undefined
      try {
        const handle = options.open()
        stop = () => handle.dispose()
        for await (const value of handle) {
          if (disposed) return
          backoff = BASE_DELAY_MS
          options.item(value)
        }
      } catch (error) {
        failure = messageOf(error)
      } finally {
        stop = undefined
      }
      if (disposed) return
      options.lost(failure)
      await pause(backoff, options.generation, attempt)
      backoff = Math.min(backoff * 2, MAX_DELAY_MS)
    }
  })()
  return () => {
    disposed = true
    stop?.()
  }
}
