import type { SessionKindDeps } from "../prompt/session-kind"

export type ConversationKind = "current" | "main" | "former-main" | "web"

export interface ConversationSource {
  readonly sessionId: string
  readonly kind: ConversationKind
}

export interface OwnerConversations {
  readonly current: ConversationSource
  readonly others: readonly ConversationSource[]
}

export interface ConversationSourcesDeps {
  readonly kind: Pick<SessionKindDeps, "isMain" | "isScheduleRun" | "isStartedByMain">
  sessionsOf(botId: string): readonly string[]
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
