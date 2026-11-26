export async function* watchStream<T>(
  read: () => T,
  subscribe: (listener: () => void) => () => void,
  signal?: AbortSignal,
): AsyncIterable<T> {
  let dirty = true
  let wake: (() => void) | undefined
  const unsubscribe = subscribe(() => {
    dirty = true
    wake?.()
  })
  const onAbort = () => wake?.()
  signal?.addEventListener("abort", onAbort)
  try {
    while (signal?.aborted !== true) {
      if (dirty) {
        dirty = false
        yield read()
        continue
      }
      await new Promise<void>((resolve) => {
        wake = resolve
      })
      wake = undefined
    }
  } finally {
    unsubscribe()
    signal?.removeEventListener("abort", onAbort)
  }
}
