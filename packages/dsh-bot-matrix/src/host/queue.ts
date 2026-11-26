export interface SerialQueue {
  push(task: () => Promise<void>): Promise<void>
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
