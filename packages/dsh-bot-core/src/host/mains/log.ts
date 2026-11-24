/** A session log event, as far as read here. */
export interface LoggedEvent {
  readonly type: string
  readonly data: unknown
}

/**
 * Successful compactions in a session log: `compaction/start` … `compaction/end`
 * brackets that recorded a `compaction/summary` and ended without an error.
 * Automatic (mid-turn) and idle compactions both count; a bracket that only
 * pruned tool results (no summary) does not.
 */
export function countCompactions(events: Iterable<LoggedEvent>): number {
  let count = 0
  let open = false
  let summarized = false
  for (const event of events) {
    switch (event.type) {
      case "compaction/start":
        open = true
        summarized = false
        break
      case "compaction/summary":
        if (open) summarized = true
        break
      case "compaction/end": {
        const failed = (event.data as { readonly error?: unknown } | null)?.error !== undefined
        if (open && summarized && !failed) count += 1
        open = false
        summarized = false
        break
      }
    }
  }
  return count
}

/** The context's fill in percent, from DSH's token meter; undefined while either number is unknown. */
export function usagePercentOf(pressure: {
  readonly pressureTokens?: number
  readonly contextWindow?: number
}): number | undefined {
  const { pressureTokens, contextWindow } = pressure
  if (pressureTokens === undefined || contextWindow === undefined || contextWindow <= 0) {
    return undefined
  }
  return (pressureTokens / contextWindow) * 100
}
