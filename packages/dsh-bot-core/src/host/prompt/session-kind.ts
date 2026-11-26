import type { BotSessionKind } from "../../internal"

export interface KindAgent {
  readonly id: string
  readonly session: { readonly header: { readonly parentSession?: string | undefined } }
}

export interface SessionKindDeps {
  isMain(botId: string, sessionId: string): boolean
  isScheduleRun(botId: string, sessionId: string): boolean
  isRecorded(botId: string, sessionId: string): boolean
  reviewed(botId: string, sessionId: string): BotSessionKind | undefined
  curating(botId: string, sessionId: string): boolean
  isStartedByMain(botId: string, sessionId: string): boolean
}

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
