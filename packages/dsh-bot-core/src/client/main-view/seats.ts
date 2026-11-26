import { createStore, type Observable } from "../observable"

/**
 * Where each Main session's own Chat view is drawn while its Session log
 * panel is open: the panel's body, by session id. The conversation's views
 * position renders DSH's Chat into it, inside the conversation's own tree.
 */
export interface SessionLogSeats extends Observable<Readonly<Record<string, HTMLElement>>> {
  /** @returns the release of the seat. */
  offer(sessionId: string, element: HTMLElement): () => void
}

export function createSessionLogSeats(): SessionLogSeats {
  const seats = createStore<Readonly<Record<string, HTMLElement>>>({})
  return {
    getSnapshot: seats.getSnapshot,
    subscribe: seats.subscribe,
    offer(sessionId, element) {
      seats.update((current) => ({ ...current, [sessionId]: element }))
      return () => {
        if (seats.getSnapshot()[sessionId] !== element) return
        seats.update(({ [sessionId]: _released, ...rest }) => rest)
      }
    },
  }
}
