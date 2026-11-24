/**
 * One curation of a bot's skills by the model (docs/specs/bot-skills.md
 * §12.2): a hidden Agent of the bot, created as review-run.ts creates a
 * review's but seeded with nothing, gets the curation prompt once and is
 * disposed when that turn ends. Its header marks it a subagent of the bot's
 * Main session, so it is in no list of sessions and nothing of it reaches
 * the bot's channels; bot-core reads it as a session of kind `curator`.
 */

import { CURATION_PROMPT } from "./texts"

export interface CuratorRecord {
  readonly botId: string
}

/** The curation Agents running now, by their session id. */
export interface CuratorSessions {
  /** @returns the disposer that forgets it. */
  add(sessionId: string, record: CuratorRecord): () => void
  get(sessionId: string): CuratorRecord | undefined
}

export function createCuratorSessions(): CuratorSessions {
  const records = new Map<string, CuratorRecord>()
  return {
    add(sessionId, record) {
      if (records.has(sessionId))
        throw new Error(`curation session "${sessionId}" is already recorded`)
      records.set(sessionId, record)
      return () => {
        if (records.get(sessionId) === record) records.delete(sessionId)
      }
    },
    get: (sessionId) => records.get(sessionId),
  }
}

export interface CuratorAgent {
  prompt(text: string, summary: string): void
  dispose(): Promise<void>
}

/** Creating the curation Agent: it, or why the bot cannot run one now. */
export type CuratorCreation =
  | { readonly kind: "created"; readonly agent: CuratorAgent }
  | { readonly kind: "unavailable"; readonly reason: string }

export interface CurationRunnerDeps {
  sessions: Pick<CuratorSessions, "add">
  newId(): string
  /** Create the bot's curation Agent in session `sessionId`; skill_manage is the only tool it may call. */
  create(botId: string, sessionId: string): Promise<CuratorCreation>
  later(ms: number, work: () => void): () => void
  /** Longest a curation runs before it is stopped. */
  readonly limitMs: number
}

export type CurationOutcome =
  | { readonly kind: "ran" }
  | { readonly kind: "unavailable"; readonly reason: string }

export interface CurationRunner {
  /** Curate the bot's skills; resolves when the curation's turn is over. */
  run(botId: string): Promise<CurationOutcome>
  /** Follow the logs: a curation's turn end ends it. */
  sessionEvent(sessionId: string, event: { readonly type: string }): void
}

export function createCurationRunner(deps: CurationRunnerDeps): CurationRunner {
  const waiting = new Map<string, () => void>()
  return {
    async run(botId) {
      const sessionId = deps.newId()
      const forget = deps.sessions.add(sessionId, { botId })
      try {
        const ended = new Promise<void>((resolve) => {
          const cancel = deps.later(deps.limitMs, resolve)
          waiting.set(sessionId, () => {
            cancel()
            resolve()
          })
        })
        const creation = await deps.create(botId, sessionId)
        if (creation.kind === "unavailable") return creation
        try {
          creation.agent.prompt(CURATION_PROMPT, "Skill curation")
          await ended
        } finally {
          await creation.agent.dispose()
        }
        return { kind: "ran" }
      } finally {
        waiting.get(sessionId)?.()
        waiting.delete(sessionId)
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
