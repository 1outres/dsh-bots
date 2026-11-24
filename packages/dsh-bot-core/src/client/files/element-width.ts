import { useCallback, useSyncExternalStore } from "react"

const UNMEASURED = () => undefined

/** The element's client width, followed with a ResizeObserver; undefined until it is mounted. */
export function useElementWidth(ref: { readonly current: HTMLElement | null }): number | undefined {
  const subscribe = useCallback(
    (listener: () => void) => {
      const element = ref.current
      if (element === null) return () => {}
      const observer = new ResizeObserver(listener)
      observer.observe(element)
      return () => observer.disconnect()
    },
    [ref],
  )
  const getSnapshot = useCallback(() => ref.current?.clientWidth, [ref])
  return useSyncExternalStore(subscribe, getSnapshot, UNMEASURED)
}
