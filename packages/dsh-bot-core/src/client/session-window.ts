import { createStore, type Observable } from "./observable"

export const WINDOW_BASE = 5
export const WINDOW_AUTO_MAX = 50

export interface WindowRow {
  readonly selected: boolean
  readonly running: boolean
}

export type SessionOverflow =
  | { readonly kind: "more"; readonly hidden: number }
  | { readonly kind: "less" }

export interface WindowedRows<Row> {
  readonly rows: readonly Row[]
  readonly overflow: SessionOverflow | undefined
  readonly limit: number
}

export function requiredWindow(rows: readonly WindowRow[]): number {
  let required = 0
  rows.forEach((row, index) => {
    const position = index + 1
    if (row.selected || (row.running && position <= WINDOW_AUTO_MAX)) required = position
  })
  return required
}

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

export function widenedWindow(limit: number, hidden: number): number {
  return hidden <= WINDOW_BASE ? Number.POSITIVE_INFINITY : limit + WINDOW_BASE
}

export type Windows = Readonly<Record<string, number>>

export interface SessionWindows extends Observable<Windows> {
  raise(botId: string, limit: number): void
  toggle(botId: string, overflow: SessionOverflow, limit: number): void
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
