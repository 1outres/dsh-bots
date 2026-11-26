import {
  type BotManagedAnswerer,
  type BotManagedSession,
  type BotManagedTarget,
  DEFAULT_ANSWERER,
} from "../../shared/managed-sessions"
import type { ManagedEnding } from "./notice"
import type { ManagedStore } from "./store"

export interface ManagedSessionsDeps {
  readonly store: ManagedStore
  botOfSession(sessionId: string): string | undefined
  workspaceOfSession(sessionId: string): string | undefined
  granted(botId: string, workspaceId: string): boolean
  mainOf(botId: string): string | undefined
  pastMain(sessionId: string): boolean
  isScheduleRun(sessionId: string): boolean
  archived(sessionId: string): boolean
  ended(session: BotManagedSession, by: ManagedEnding): Promise<void>
  now(): number
}

export type ManagedReleaser = "owner" | "main"

export interface ManagedSessions {
  list(botId?: string): readonly BotManagedSession[]
  get(sessionId: string): BotManagedSession | undefined
  require(botId: string, sessionId: string): BotManagedSession
  targetOf(
    botId: string,
    sessionId: string,
  ): { readonly target: BotManagedTarget } | { readonly problem: string }
  start(
    botId: string,
    sessionId: string,
    options: {
      readonly target: BotManagedTarget
      readonly answerer: BotManagedAnswerer
      readonly label: string
    },
  ): Promise<BotManagedSession>
  entrust(botId: string, sessionId: string): Promise<BotManagedSession>
  release(botId: string, sessionId: string, by: ManagedReleaser): Promise<void>
  setAnswerer(
    botId: string,
    sessionId: string,
    answerer: BotManagedAnswerer,
  ): Promise<BotManagedSession>
  archived(sessionId: string): Promise<void>
  grantEnded(botId: string, workspaceId: string, by: "revoked" | "workspace-removed"): Promise<void>
  purge(keep: (botId: string) => boolean): Promise<void>
  subscribe(listener: () => void): () => void
}

const BOT_TARGET: BotManagedTarget = Object.freeze({ kind: "bot" })

const sameTarget = (left: BotManagedTarget, right: BotManagedTarget) =>
  left.kind === "bot"
    ? right.kind === "bot"
    : right.kind === "workspace" && right.workspaceId === left.workspaceId

export function createManagedSessions(deps: ManagedSessionsDeps): ManagedSessions {
  const { store } = deps

  const botSessionProblem = (botId: string, sessionId: string): string | undefined => {
    if (deps.mainOf(botId) === sessionId) return "the Main session cannot be managed"
    if (deps.pastMain(sessionId)) return "a former Main session cannot be managed"
    if (deps.isScheduleRun(sessionId)) return "a scheduled run's session cannot be managed"
    return undefined
  }

  const targetOf: ManagedSessions["targetOf"] = (botId, sessionId) => {
    const owner = deps.botOfSession(sessionId)
    const problem = (text: string) => ({ problem: text })
    if (owner !== undefined) {
      if (owner !== botId) return problem(`session "${sessionId}" is not a session of this bot`)
      const refused = botSessionProblem(botId, sessionId)
      if (refused !== undefined) return problem(refused)
    } else {
      const workspaceId = deps.workspaceOfSession(sessionId)
      if (workspaceId === undefined) {
        return problem(
          `session "${sessionId}" is neither a session of this bot nor one of a Workspace granted to it`,
        )
      }
      if (!deps.granted(botId, workspaceId)) {
        return problem(`Workspace "${workspaceId}" is not granted to this bot`)
      }
    }
    if (deps.archived(sessionId)) return problem(`session "${sessionId}" is archived`)
    const workspaceId = owner === undefined ? deps.workspaceOfSession(sessionId) : undefined
    return {
      target: workspaceId === undefined ? BOT_TARGET : { kind: "workspace", workspaceId },
    }
  }

  const require = (botId: string, sessionId: string): BotManagedSession => {
    const session = store.get(sessionId)
    if (session === undefined || session.botId !== botId) {
      throw new Error(`session "${sessionId}" is not managed by this bot's Main session`)
    }
    return session
  }

  const admit = (botId: string, sessionId: string): BotManagedTarget => {
    const found = targetOf(botId, sessionId)
    if ("problem" in found) throw new Error(found.problem)
    if (store.get(sessionId) !== undefined) {
      throw new Error(`session "${sessionId}" is already managed`)
    }
    return found.target
  }

  const recordOf = ({ sessionId: _id, ...record }: BotManagedSession) => record

  const end = async (session: BotManagedSession, by: ManagedEnding) => {
    if (await store.delete(session.sessionId)) await deps.ended(session, by)
  }

  return {
    list: (botId) => store.list(botId),
    get: (sessionId) => store.get(sessionId),
    require,
    targetOf,
    async start(botId, sessionId, options) {
      const target = admit(botId, sessionId)
      if (!sameTarget(target, options.target)) {
        throw new Error(`session "${sessionId}" does not run where it was started for`)
      }
      return store.put(sessionId, {
        botId,
        target,
        answerer: options.answerer,
        origin: "main",
        label: options.label,
        since: deps.now(),
      })
    },
    async entrust(botId, sessionId) {
      const target = admit(botId, sessionId)
      return store.put(sessionId, {
        botId,
        target,
        answerer: DEFAULT_ANSWERER[target.kind],
        origin: "owner",
        since: deps.now(),
      })
    },
    async release(botId, sessionId, by) {
      const session = require(botId, sessionId)
      if (!(await store.delete(sessionId))) return
      if (by === "owner") await deps.ended(session, "owner")
    },
    async setAnswerer(botId, sessionId, answerer) {
      const session = require(botId, sessionId)
      if (session.answerer === answerer) return session
      return store.put(sessionId, { ...recordOf(session), answerer })
    },
    async archived(sessionId) {
      const session = store.get(sessionId)
      if (session !== undefined) await end(session, "archive")
    },
    async grantEnded(botId, workspaceId, by) {
      for (const session of store.list(botId)) {
        if (session.target.kind === "workspace" && session.target.workspaceId === workspaceId) {
          await end(session, by)
        }
      }
    },
    purge: (keep) => store.purge(keep),
    subscribe: (listener) => store.subscribe(listener),
  }
}
