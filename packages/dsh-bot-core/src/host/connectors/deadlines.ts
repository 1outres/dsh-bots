export interface DeadlinesDeps {
  /** Run `work` after `ms` (bounded by the timer's limit); returns the cancel. */
  later(ms: number, work: () => void): () => void
  now(): number
  /** Longest single timer delay. */
  readonly maxDelayMs: number
}

/** One timer per key, due at an instant however far away (longer waits are chained). */
export interface Deadlines {
  /** Call `due` at `at` (at once when past); replaces the key's earlier one. */
  arm(key: string, at: number, due: () => void): void
  disarm(key: string): void
  dispose(): void
}

export function createDeadlines(deps: DeadlinesDeps): Deadlines {
  const timers = new Map<string, () => void>()
  const arm = (key: string, at: number, due: () => void) => {
    timers.get(key)?.()
    const remaining = at - deps.now()
    if (remaining <= 0) {
      timers.delete(key)
      due()
      return
    }
    const step = Math.min(remaining, deps.maxDelayMs)
    timers.set(
      key,
      deps.later(step, () => {
        timers.delete(key)
        arm(key, at, due)
      }),
    )
  }
  return {
    arm,
    disarm(key) {
      timers.get(key)?.()
      timers.delete(key)
    },
    dispose() {
      for (const cancel of timers.values()) cancel()
      timers.clear()
    },
  }
}
