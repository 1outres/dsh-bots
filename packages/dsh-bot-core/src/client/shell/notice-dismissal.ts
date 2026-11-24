import { createStore, type Observable } from "../observable"

/** A notice the user dismissed for the page's lifetime. */
export interface NoticeDismissal extends Observable<boolean> {
  dismiss(): void
}

export function createNoticeDismissal(): NoticeDismissal {
  const dismissed = createStore(false)
  return {
    getSnapshot: dismissed.getSnapshot,
    subscribe: dismissed.subscribe,
    dismiss: () => dismissed.set(true),
  }
}
