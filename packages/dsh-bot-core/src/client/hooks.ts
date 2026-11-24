import { useCallback, useEffect, useState, useSyncExternalStore } from "react"
import type { Observable } from "./types"

export { isSelected } from "./tree"

export function useObservable<T>(observable: Observable<T>): T {
  const subscribe = useCallback(
    (listener: () => void) => observable.subscribe(listener),
    [observable],
  )
  const getSnapshot = useCallback(() => observable.getSnapshot(), [observable])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const unsubscribed = () => {}

/** {@link useObservable} for a value that may not exist; undefined while it does not. */
export function useOptionalObservable<T>(observable: Observable<T> | undefined): T | undefined {
  const subscribe = useCallback(
    (listener: () => void) =>
      observable === undefined ? unsubscribed : observable.subscribe(listener),
    [observable],
  )
  const getSnapshot = useCallback(() => observable?.getSnapshot(), [observable])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** The current time, every second while `running`. */
export function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  return now
}
