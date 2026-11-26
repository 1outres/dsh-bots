export const REVIEW_STEPS = 10
export const REVIEW_QUIET_MS = 30_000

export interface ReviewRecord {
  readonly botId: string
  readonly sessionId: string
  readonly kind: "main" | "web"
}

export interface ReviewSessions {
  add(reviewId: string, record: ReviewRecord): () => void
  get(reviewId: string): ReviewRecord | undefined
}

export function createReviewSessions(): ReviewSessions {
  const records = new Map<string, ReviewRecord>()
  return {
    add(reviewId, record) {
      if (records.has(reviewId)) throw new Error(`review session "${reviewId}" is already recorded`)
      records.set(reviewId, record)
      return () => {
        if (records.get(reviewId) === record) records.delete(reviewId)
      }
    },
    get: (reviewId) => records.get(reviewId),
  }
}

export interface SkillReviewDeps {
  enabled(botId: string): boolean
  idle(sessionId: string): boolean
  run(botId: string, sessionId: string): Promise<void>
  later(ms: number, work: () => void): () => void
  warn(message: string): void
}

export interface SkillReviews {
  stepped(botId: string, sessionId: string): void
  turnEnded(botId: string, sessionId: string): void
  busy(sessionId: string): void
  reviewing(sessionId: string): boolean
  dispose(): void
}

interface Entry {
  botId: string
  steps: number
  timer: (() => void) | undefined
  running: boolean
}

export function createSkillReviews(deps: SkillReviewDeps): SkillReviews {
  const entries = new Map<string, Entry>()
  let disposed = false
  const entryOf = (botId: string, sessionId: string): Entry => {
    let entry = entries.get(sessionId)
    if (entry === undefined) {
      entry = { botId, steps: 0, timer: undefined, running: false }
      entries.set(sessionId, entry)
    }
    return entry
  }
  const cancel = (entry: Entry) => {
    entry.timer?.()
    entry.timer = undefined
  }
  const fire = (sessionId: string, entry: Entry) => {
    entry.timer = undefined
    if (disposed || entry.running || entry.steps < REVIEW_STEPS) return
    if (!deps.enabled(entry.botId) || !deps.idle(sessionId)) return
    entry.steps = 0
    entry.running = true
    deps
      .run(entry.botId, sessionId)
      .catch((error: unknown) => {
        deps.warn(`bot-core: the skill review of session "${sessionId}" failed: ${String(error)}`)
      })
      .finally(() => {
        entry.running = false
      })
  }
  return {
    stepped(botId, sessionId) {
      const entry = entryOf(botId, sessionId)
      entry.steps += 1
      cancel(entry)
    },
    turnEnded(botId, sessionId) {
      const entry = entryOf(botId, sessionId)
      cancel(entry)
      if (entry.steps < REVIEW_STEPS || entry.running) return
      entry.timer = deps.later(REVIEW_QUIET_MS, () => fire(sessionId, entry))
    },
    busy(sessionId) {
      const entry = entries.get(sessionId)
      if (entry !== undefined) cancel(entry)
    },
    reviewing: (sessionId) => entries.get(sessionId)?.running === true,
    dispose() {
      disposed = true
      for (const entry of entries.values()) cancel(entry)
      entries.clear()
    },
  }
}
