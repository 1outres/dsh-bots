import type { BotSessionKind } from "../../internal"

/** The slice of a live Agent the session kind reads. */
export interface KindAgent {
  readonly id: string
  readonly session: { readonly header: { readonly parentSession?: string | undefined } }
}

/** bot-core's records a session's kind is read from. */
export interface SessionKindDeps {
  /** The bot's record names the session as its Main. */
  isMain(botId: string, sessionId: string): boolean
  /** A stored run of one of the bot's `separate` jobs ran in the session. */
  isScheduleRun(botId: string, sessionId: string): boolean
  /** The session is recorded as the bot's (`Bot.createSession`, an adopted fork). */
  isRecorded(botId: string, sessionId: string): boolean
  /**
   * The kind of the session a background skill review of the bot runs for,
   * when `sessionId` is that review's (host/skills/review.ts): the review
   * reads as the session it reviews, so its prompt and tool list are that
   * session's and its request reuses that session's cached prefix.
   */
  reviewed(botId: string, sessionId: string): BotSessionKind | undefined
  /** The session is a curation of the bot's skills running now (host/skills/curation-run.ts). */
  curating(botId: string, sessionId: string): boolean
  /** Its record says the bot's Main session started it (`session_start`). */
  isStartedByMain(botId: string, sessionId: string): boolean
}

/**
 * Which session of `botId` the Agent runs. Every record read here is written
 * before the session's first turn and never changes afterwards, so the kind
 * stays the same for the whole session.
 * @throws when bot-core has no record of the session as the bot's.
 */
export function sessionKindOf(
  deps: SessionKindDeps,
  botId: string,
  agent: KindAgent,
): BotSessionKind {
  if (deps.curating(botId, agent.id)) return "curator"
  const reviewed = deps.reviewed(botId, agent.id)
  if (reviewed !== undefined) return reviewed
  if (agent.session.header.parentSession !== undefined) return "subagent"
  if (deps.isMain(botId, agent.id)) return "main"
  if (deps.isScheduleRun(botId, agent.id)) return "schedule"
  if (deps.isStartedByMain(botId, agent.id)) return "delegated"
  if (deps.isRecorded(botId, agent.id)) return "web"
  throw new Error(`session "${agent.id}" is not recorded as a session of bot "${botId}"`)
}
