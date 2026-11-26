export interface OwnChanges {
  record(connectionId: string, eventId: string): void
  isOwn(connectionId: string, eventId: string): boolean
}

export function createOwnChanges(now: () => number, keepMs: number): OwnChanges {
  const changes = new Map<string, number>()
  const keyOf = (connectionId: string, eventId: string) => JSON.stringify([connectionId, eventId])
  const sweep = () => {
    const limit = now() - keepMs
    for (const [key, at] of changes) if (at < limit) changes.delete(key)
  }
  return {
    record(connectionId, eventId) {
      sweep()
      changes.set(keyOf(connectionId, eventId), now())
    },
    isOwn(connectionId, eventId) {
      sweep()
      return changes.has(keyOf(connectionId, eventId))
    },
  }
}
