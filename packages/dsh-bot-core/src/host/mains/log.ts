export interface LoggedEvent {
  readonly type: string
  readonly data: unknown
}

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
