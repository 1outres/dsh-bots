import type { MatrixApi, MatrixEvent } from "./matrix"

export const CATCH_UP_LIMIT = 200
const PAGE = 50

export interface CaughtUp {
  readonly events: readonly MatrixEvent[]
  readonly complete: boolean
}

export async function catchUp(
  api: Pick<MatrixApi, "messages">,
  roomId: string,
  from: string,
  lastEventId: string,
  signal: AbortSignal,
): Promise<CaughtUp> {
  const found: MatrixEvent[] = []
  let token: string | undefined = from
  while (token !== undefined && found.length < CATCH_UP_LIMIT) {
    const page = await api.messages(roomId, token, PAGE, signal)
    for (const event of page.chunk) {
      if (event.eventId === lastEventId) return { events: found.reverse(), complete: true }
      found.push(event)
      if (found.length >= CATCH_UP_LIMIT) break
    }
    if (page.chunk.length === 0) break
    token = page.end
  }
  return { events: found.reverse(), complete: false }
}
