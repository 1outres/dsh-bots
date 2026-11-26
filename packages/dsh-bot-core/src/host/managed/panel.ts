import {
  type BotManagedSession,
  type BotManagedSessionsSnapshot,
  parseAnswerer,
  parseManagedId,
} from "../../shared/managed-sessions"
import type { ManagedSessions } from "./sessions"

export interface ManagedPanel {
  snapshot(): BotManagedSessionsSnapshot
  entrust(botId: unknown, sessionId: unknown): Promise<BotManagedSession>
  release(botId: unknown, sessionId: unknown): Promise<BotManagedSessionsSnapshot>
  setAnswerer(botId: unknown, sessionId: unknown, answerer: unknown): Promise<BotManagedSession>
}

export function createManagedPanel(deps: {
  readonly sessions: ManagedSessions
  listed(botId: string): boolean
}): ManagedPanel {
  const ids = (botId: unknown, sessionId: unknown) => {
    const bot = parseManagedId(botId, "botId")
    if (!deps.listed(bot)) throw new Error(`bot "${bot}" does not exist`)
    return [bot, parseManagedId(sessionId, "sessionId")] as const
  }
  const snapshot = (): BotManagedSessionsSnapshot => ({ sessions: deps.sessions.list() })
  return {
    snapshot,
    async entrust(botId, sessionId) {
      return deps.sessions.entrust(...ids(botId, sessionId))
    },
    async release(botId, sessionId) {
      const [bot, session] = ids(botId, sessionId)
      await deps.sessions.release(bot, session, "owner")
      return snapshot()
    },
    async setAnswerer(botId, sessionId, answerer) {
      const [bot, session] = ids(botId, sessionId)
      return deps.sessions.setAnswerer(bot, session, parseAnswerer(answerer))
    },
  }
}
