import { CURATION_PROMPT } from "./texts"

export interface CuratorRecord {
  readonly botId: string
}

export interface CuratorSessions {
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

export type CuratorCreation =
  | { readonly kind: "created"; readonly agent: CuratorAgent }
  | { readonly kind: "unavailable"; readonly reason: string }

export interface CurationRunnerDeps {
  sessions: Pick<CuratorSessions, "add">
  newId(): string
  create(botId: string, sessionId: string): Promise<CuratorCreation>
  later(ms: number, work: () => void): () => void
  readonly limitMs: number
}

export type CurationOutcome =
  | { readonly kind: "ran" }
  | { readonly kind: "unavailable"; readonly reason: string }

export interface CurationRunner {
  run(botId: string): Promise<CurationOutcome>
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
