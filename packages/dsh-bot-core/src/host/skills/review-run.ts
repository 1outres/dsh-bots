/**
 * One background skill review (docs/specs/bot-skills.md §6): a separate Agent
 * seeded with the reviewed session's completed turns, as DSH's fork backend
 * seeds a child (`dsh-subagent-fork-in-process`), on the same preset
 * revision and model, so its prompt and tool list are the session's and its
 * request reuses the session's cached prefix. It gets the review prompt once
 * and is disposed when that turn ends. It is no session of the bot's lists:
 * its header marks it a subagent of the reviewed session, and nothing of it
 * reaches the bot's channels.
 */

import type { ReviewSessions } from "./review"
import { REVIEW_PROMPT } from "./texts"

/** The reviewed session's Agent, as far as a review reads it. */
export interface ReviewSource {
  readonly id: string
  readonly session: {
    readonly header: { readonly cwd?: string; readonly agentPreset?: string }
    /** Its whole log, contiguous from seq 0. */
    snapshotEvents(): readonly ReviewSeedEvent[]
    /** The route of its latest model request. */
    requestHeader(): { readonly config: ReviewRoute } | undefined
  }
}

export interface ReviewSeedEvent {
  readonly type: string
  readonly seq: number
}

export interface ReviewRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

/** What creating the review Agent needs (dsh-agent `agents.create` with a fork seed). */
export interface ReviewAgentRequest {
  readonly reviewId: string
  readonly parentSession: string
  readonly cwd: string
  readonly agentPreset: string
  readonly seed: readonly ReviewSeedEvent[]
  readonly route: ReviewRoute
}

export interface ReviewAgent {
  /** Hand it the review prompt. */
  prompt(text: string, summary: string): void
  dispose(): Promise<void>
}

export interface ReviewRunnerDeps {
  /** The reviewed session's live Agent. */
  source(sessionId: string): ReviewSource | undefined
  /** The reviewed session's kind: only Main and Web sessions are reviewed. */
  kind(botId: string, sessionId: string): "main" | "web" | undefined
  reviews: Pick<ReviewSessions, "add">
  newId(): string
  /** Create the review Agent; skill_manage is the only tool it may call. */
  create(request: ReviewAgentRequest): Promise<ReviewAgent>
  later(ms: number, work: () => void): () => void
  /** Longest a review runs before it is stopped. */
  readonly limitMs: number
}

export interface ReviewRunner {
  /** Review the session's conversation up to its last completed turn; resolves when the review is over. */
  run(botId: string, sessionId: string): Promise<void>
  /** Follow the logs: a review's turn end ends it. */
  sessionEvent(sessionId: string, event: { readonly type: string }): void
}

/** The completed-turn prefix of a log: every event up to and including its last `turn/end`. */
export function completedTurns(events: readonly ReviewSeedEvent[]): readonly ReviewSeedEvent[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as ReviewSeedEvent
    if (event.type === "turn/end") return events.slice(0, event.seq + 1)
  }
  return []
}

export function createReviewRunner(deps: ReviewRunnerDeps): ReviewRunner {
  const waiting = new Map<string, () => void>()
  return {
    async run(botId, sessionId) {
      const kind = deps.kind(botId, sessionId)
      const source = deps.source(sessionId)
      if (kind === undefined || source === undefined) return
      const route = source.session.requestHeader()?.config
      const { cwd, agentPreset } = source.session.header
      const seed = completedTurns(source.session.snapshotEvents())
      if (
        route === undefined ||
        cwd === undefined ||
        agentPreset === undefined ||
        seed.length === 0
      )
        return
      const reviewId = deps.newId()
      const forget = deps.reviews.add(reviewId, { botId, sessionId, kind })
      try {
        const ended = new Promise<void>((resolve) => {
          const cancel = deps.later(deps.limitMs, resolve)
          waiting.set(reviewId, () => {
            cancel()
            resolve()
          })
        })
        const agent = await deps.create({
          reviewId,
          parentSession: sessionId,
          cwd,
          agentPreset,
          seed,
          route,
        })
        try {
          agent.prompt(REVIEW_PROMPT, "Background skill review")
          await ended
        } finally {
          await agent.dispose()
        }
      } finally {
        waiting.get(reviewId)?.()
        waiting.delete(reviewId)
        forget()
      }
    },
    sessionEvent(sessionId, event) {
      if (event.type !== "turn/end") return
      const done = waiting.get(sessionId)
      if (done === undefined) return
      waiting.delete(sessionId)
      done()
    },
  }
}
