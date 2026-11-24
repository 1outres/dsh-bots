/** Runs tasks one after another, in submission order; a failing task does not stop the next. */
export interface SerialQueue {
  push(task: () => Promise<void>): Promise<void>
  /** Resolves once every task pushed so far settled. */
  idle(): Promise<void>
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<void> = Promise.resolve()
  return {
    push(task) {
      const next = tail.then(task, task)
      tail = next.catch(() => {})
      return next
    },
    idle: () => tail,
  }
}
