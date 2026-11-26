import { useCallback } from "react"
import { createStore, type Observable } from "../observable"

export interface PopoverHost extends Observable<HTMLElement | null> {
  attach(element: HTMLElement | null): void
}

export function createPopoverHost(): PopoverHost {
  const element = createStore<HTMLElement | null>(null)
  return {
    getSnapshot: element.getSnapshot,
    subscribe: element.subscribe,
    attach: (next) => element.set(next),
  }
}

export interface PopoverHostFace {
  readonly host: PopoverHost
}

export function PopoverHostView({ host }: PopoverHostFace) {
  const ref = useCallback((element: HTMLDivElement | null) => host.attach(element), [host])
  return <div ref={ref} className="dshb-popover-host" data-dshb-popover-host="" />
}
