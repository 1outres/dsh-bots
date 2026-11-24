/**
 * When the background skill review of a conversation runs
 * (docs/specs/bot-skills.md §6): after {@link REVIEW_STEPS} steps of a Main or
 * Web session since its last review, once a turn has ended and nothing has
 * happened for {@link REVIEW_QUIET_MS}. One review of a session at a time.
 */

/** Model steps of a session that call for a review. */
export const REVIEW_STEPS = 10
/** How long a session stays quiet after a turn before its review starts. */
export const REVIEW_QUIET_MS = 30_000

/** Which session a review Agent reviews, and that session's kind. */
export interface ReviewRecord {
  readonly botId: string
  readonly sessionId: string
  readonly kind: "main" | "web"
}

/** The review Agents running now, by their session id. */
export interface ReviewSessions {
  /** @returns the disposer that forgets it. */
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
  /** The bot's `skillReview` setting. */
  enabled(botId: string): boolean
  /** The session's Agent is idle with nothing waiting. */
  idle(sessionId: string): boolean
  /** Review the session's conversation; resolves when the review is over. */
  run(botId: string, sessionId: string): Promise<void>
  later(ms: number, work: () => void): () => void
  warn(message: string): void
}

export interface SkillReviews {
  /** A step of a Main or Web session started. */
  stepped(botId: string, sessionId: string): void
  /** A turn of a Main or Web session ended. */
  turnEnded(botId: string, sessionId: string): void
  /** The session started working again: its quiet wait starts over at its next turn end. */
  busy(sessionId: string): void
  /** Whether a review of the session runs now. */
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
