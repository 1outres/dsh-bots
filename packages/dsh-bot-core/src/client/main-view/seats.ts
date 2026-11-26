import { createStore, type Observable } from "../observable"

export interface SessionLogSeats extends Observable<Readonly<Record<string, HTMLElement>>> {
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
