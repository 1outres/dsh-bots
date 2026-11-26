export interface SessionPreparations {
  run<T>(sessionId: string, work: () => Promise<T>): Promise<T>
  ids(): readonly string[]
  subscribe(listener: () => void): () => void
}

export function createSessionPreparations(): SessionPreparations {
  const running = new Map<string, number>()
  const listeners = new Set<() => void>()
  const publish = () => {
    for (const listener of [...listeners]) listener()
  }
  const settle = (sessionId: string) => {
    const left = (running.get(sessionId) ?? 0) - 1
    if (left > 0) {
      running.set(sessionId, left)
      return
    }
    running.delete(sessionId)
    publish()
  }
  return {
    async run(sessionId, work) {
      const before = running.get(sessionId) ?? 0
      running.set(sessionId, before + 1)
      if (before === 0) publish()
      try {
        return await work()
      } finally {
        settle(sessionId)
      }
    },
    ids: () => [...running.keys()],
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
