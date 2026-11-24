import { createStore, type Observable } from "./observable"

/** Non-Main rows a bot lists while nothing raises its window (Workspaces' `SESSION_WATERMARK_BASE`). */
export const WINDOW_BASE = 5
/** The farthest row a running session raises the window to on its own (Workspaces' `SESSION_WATERMARK_AUTO_MAX`). */
export const WINDOW_AUTO_MAX = 50

/** What a row tells the window about itself. */
export interface WindowRow {
  readonly selected: boolean
  readonly running: boolean
}

/** The row under the fold of a bot's list: show the rest, or fold back. */
export type SessionOverflow =
  | { readonly kind: "more"; readonly hidden: number }
  | { readonly kind: "less" }

export interface WindowedRows<Row> {
  readonly rows: readonly Row[]
  readonly overflow: SessionOverflow | undefined
  /** How many rows the window holds, to keep it from shrinking under them. */
  readonly limit: number
}

/**
 * The smallest window that shows the selected row wherever it is, and every
 * running row within {@link WINDOW_AUTO_MAX}.
 */
export function requiredWindow(rows: readonly WindowRow[]): number {
  let required = 0
  rows.forEach((row, index) => {
    const position = index + 1
    if (row.selected || (row.running && position <= WINDOW_AUTO_MAX)) required = position
  })
  return required
}

/**
 * The rows a bot lists, newest first, as Workspaces' "Show more": the window
 * is the larger of the user's (`stored`, the base when absent) and what the
 * rows require; the overflow row shows while the folded window hides any.
 */
export function windowRows<Row extends WindowRow>(
  rows: readonly Row[],
  stored: number | undefined,
): WindowedRows<Row> {
  const baseline = Math.max(WINDOW_BASE, requiredWindow(rows))
  const limit = Math.max(stored ?? WINDOW_BASE, baseline)
  const shown = rows.slice(0, limit)
  const overflow: SessionOverflow | undefined =
    rows.length <= baseline
      ? undefined
      : shown.length === rows.length
        ? { kind: "less" }
        : { kind: "more", hidden: rows.length - shown.length }
  return { rows: shown, overflow, limit }
}

/** The window after "Show more": the next {@link WINDOW_BASE} rows, or all once that few remain. */
export function widenedWindow(limit: number, hidden: number): number {
  return hidden <= WINDOW_BASE ? Number.POSITIVE_INFINITY : limit + WINDOW_BASE
}

export type Windows = Readonly<Record<string, number>>

/** Each bot's window over its sessions for this page; a bot without one has the base window. */
export interface SessionWindows extends Observable<Windows> {
  /** Keep the window at least `limit`, so rows that raised it stay listed. */
  raise(botId: string, limit: number): void
  /** Answer the overflow row: show more rows, or fold back to the base window. */
  toggle(botId: string, overflow: SessionOverflow, limit: number): void
  /** Back to the base window, as when the bot is collapsed. */
  reset(botId: string): void
}

export function createSessionWindows(): SessionWindows {
  const windows = createStore<Windows>({})
  const put = (botId: string, limit: number) =>
    windows.update((current) => ({ ...current, [botId]: limit }))
  const reset = (botId: string) =>
    windows.update((current) => {
      if (!(botId in current)) return current
      const { [botId]: _dropped, ...rest } = current
      return rest
    })
  return {
    getSnapshot: windows.getSnapshot,
    subscribe: windows.subscribe,
    raise(botId, limit) {
      if (limit > (windows.getSnapshot()[botId] ?? WINDOW_BASE)) put(botId, limit)
    },
    toggle(botId, overflow, limit) {
      switch (overflow.kind) {
        case "more":
          put(botId, widenedWindow(limit, overflow.hidden))
          break
        case "less":
          reset(botId)
          break
      }
    },
    reset,
  }
}
