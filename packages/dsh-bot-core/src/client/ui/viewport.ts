import { useSyncExternalStore } from "react"

/** The width at and below which settings and panels become full-screen sheets. */
export const COMPACT_QUERY = "(max-width: 640px)"

const subscribe = (listener: () => void) => {
  const query = window.matchMedia(COMPACT_QUERY)
  query.addEventListener("change", listener)
  return () => query.removeEventListener("change", listener)
}

const compact = () => window.matchMedia(COMPACT_QUERY).matches
const wide = () => false

/** Whether the window is narrow enough for the compact (sheet) layout. */
export function useCompactLayout(): boolean {
  return useSyncExternalStore(subscribe, compact, wide)
}
