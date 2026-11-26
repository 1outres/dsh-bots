import type { BotSessionModelRequest, BotSessionOptions } from "../../contract"
import type { SessionMembership } from "../domain"
import type { SessionModel } from "../models/models"
import type { PresetRealizer } from "./realize"

export interface BotSessionDeps {
  realizer: Pick<PresetRealizer, "run">
  exists(botId: string): boolean
  workspace(): string | undefined
  model(botId: string, request: BotSessionModelRequest): Promise<SessionModel>
  create(request: {
    cwd: string
    agentPreset: string
    model: SessionModel
  }): Promise<{ sessionId: string; agentPreset: string }>
  adopt(botId: string, sessionId: string, membership: SessionMembership): Promise<unknown>
  prepare(sessionId: string): void
  rename(sessionId: string, title: string): Promise<void>
  warn(message: string): void
}

const MAIN_MODEL: BotSessionModelRequest = Object.freeze({ role: "main" })

export class BotPresetNotReadyError extends Error {
  constructor(botId: string, problem: string) {
    super(`bot "${botId}" cannot start a session: its Agent preset is not ready: ${problem}`)
    this.name = "BotPresetNotReadyError"
  }
}

export function createBotSessions(deps: BotSessionDeps) {
  return {
    create(
      botId: string,
      options: BotSessionOptions = {},
      membership: SessionMembership = {},
    ): Promise<{ sessionId: string }> {
      return deps.realizer.run(botId, async (state) => {
        if (!state.ready) throw new BotPresetNotReadyError(botId, state.problem)
        if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
        const cwd = deps.workspace()
        if (cwd === undefined) {
          throw new BotPresetNotReadyError(botId, "no bot environment is registered")
        }
        const model = await deps.model(botId, options.model ?? MAIN_MODEL)
        const created = await deps.create({ cwd, agentPreset: state.id, model })
        await deps.adopt(botId, created.sessionId, membership)
        deps.prepare(created.sessionId)
        if (created.agentPreset !== state.id) {
          throw new Error(
            `session "${created.sessionId}" of bot "${botId}" was composed from "${created.agentPreset}" instead of "${state.id}"`,
          )
        }
        const title = options.title?.trim()
        if (title !== undefined && title !== "") {
          try {
            await deps.rename(created.sessionId, title)
          } catch (error) {
            deps.warn(`bot-core: could not title session "${created.sessionId}": ${String(error)}`)
          }
        }
        return { sessionId: created.sessionId }
      })
    },
  }
}
