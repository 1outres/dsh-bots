/**
 * Which sessions of a bot are its conversations with its owner
 * (docs/specs/bot-session-search.md §1), read from bot-core's records only:
 * the Main, the former Mains and the sessions the owner opened in the Web UI.
 * Schedule runs and sessions the Main started are not; subagents and skill
 * reviews are never recorded as the bot's. The caller's own conversation is
 * one of them, read only for what a compaction took out of its context.
 */
import type { SessionKindDeps } from "../prompt/session-kind"

export type ConversationKind = "current" | "main" | "former-main" | "web"

export interface ConversationSource {
  readonly sessionId: string
  readonly kind: ConversationKind
}

export interface OwnerConversations {
  /** The conversation the caller runs. */
  readonly current: ConversationSource
  /** The others, in the order of the bot's records. */
  readonly others: readonly ConversationSource[]
}

export interface ConversationSourcesDeps {
  readonly kind: Pick<SessionKindDeps, "isMain" | "isScheduleRun" | "isStartedByMain">
  /** Every session recorded as the bot's, its Main included. */
  sessionsOf(botId: string): readonly string[]
  /** The session was the bot's Main and a new Main took its place. */
  pastMain(sessionId: string): boolean
}

type RecordedKind = Exclude<ConversationKind, "current">

function kindOf(
  deps: ConversationSourcesDeps,
  botId: string,
  sessionId: string,
): RecordedKind | undefined {
  if (deps.kind.isMain(botId, sessionId)) return "main"
  if (deps.pastMain(sessionId)) return "former-main"
  if (deps.kind.isScheduleRun(botId, sessionId)) return undefined
  if (deps.kind.isStartedByMain(botId, sessionId)) return undefined
  return "web"
}

/**
 * The bot's conversations with its owner, the one `callerId` runs apart.
 * @throws when `callerId` runs none of them.
 */
export function ownerConversations(
  deps: ConversationSourcesDeps,
  botId: string,
  callerId: string,
): OwnerConversations {
  const recorded = deps.sessionsOf(botId).flatMap((sessionId): ConversationSource[] => {
    const kind = kindOf(deps, botId, sessionId)
    return kind === undefined ? [] : [{ sessionId, kind }]
  })
  if (!recorded.some((source) => source.sessionId === callerId)) {
    throw new Error(`session "${callerId}" is not a conversation of bot "${botId}" with its owner`)
  }
  return {
    current: { sessionId: callerId, kind: "current" },
    others: recorded.filter((source) => source.sessionId !== callerId),
  }
}
