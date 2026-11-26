export interface PeerPairPauses {
  pause(a: string, b: string, until: number): void
  until(a: string, b: string): number | undefined
  subscribe(listener: () => void): () => void
}

const pairKey = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`)

export function createPeerPairPauses(deps: { now(): number }): PeerPairPauses {
  const pauses = new Map<string, number>()
  const listeners = new Set<() => void>()
  return {
    pause(a, b, until) {
      pauses.set(pairKey(a, b), until)
      for (const listener of [...listeners]) listener()
    },
    until(a, b) {
      const key = pairKey(a, b)
      const until = pauses.get(key)
      if (until === undefined) return undefined
      if (until > deps.now()) return until
      pauses.delete(key)
      return undefined
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
