import type { ReviewSessions } from "./review"
import { REVIEW_PROMPT } from "./texts"

export interface ReviewSource {
  readonly id: string
  readonly session: {
    readonly header: { readonly cwd?: string; readonly agentPreset?: string }
    snapshotEvents(): readonly ReviewSeedEvent[]
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

export interface ReviewAgentRequest {
  readonly reviewId: string
  readonly parentSession: string
  readonly cwd: string
  readonly agentPreset: string
  readonly seed: readonly ReviewSeedEvent[]
  readonly route: ReviewRoute
}

export interface ReviewAgent {
  prompt(text: string, summary: string): void
  dispose(): Promise<void>
}

export interface ReviewRunnerDeps {
  source(sessionId: string): ReviewSource | undefined
  kind(botId: string, sessionId: string): "main" | "web" | undefined
  reviews: Pick<ReviewSessions, "add">
  newId(): string
  create(request: ReviewAgentRequest): Promise<ReviewAgent>
  later(ms: number, work: () => void): () => void
  readonly limitMs: number
}

export interface ReviewRunner {
  run(botId: string, sessionId: string): Promise<void>
  sessionEvent(sessionId: string, event: { readonly type: string }): void
}

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
