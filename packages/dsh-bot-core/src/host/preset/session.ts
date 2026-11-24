/**
 * `Bot.createSession`: the one way a bot's session starts. It runs in the
 * bot's realizer turn, so the bot's preset cannot be swapped between the
 * readiness check and the session's composition.
 *
 * A bot session belongs to no Host Workspace and has no Host directory: it is
 * created directly as an Agent (`agents.create`, injected as
 * {@link BotSessionDeps.create}) whose working directory is the environment's
 * workspace, under the bot's preset, and recorded as the bot's
 * ({@link BotSessionDeps.adopt}). DSH's `sessionController.create` cannot be
 * used: it makes the directory on the Host first.
 */
import type { BotSessionModelRequest, BotSessionOptions } from "../../contract"
import type { SessionMembership } from "../domain"
import type { SessionModel } from "../models/models"
import type { PresetRealizer } from "./realize"

export interface BotSessionDeps {
  realizer: Pick<PresetRealizer, "run">
  /** Whether the bot is stored (also one whose Main is still being created). */
  exists(botId: string): boolean
  /** The registered environment's workspace, or undefined without one. */
  workspace(): string | undefined
  /**
   * The model the bot's new session starts on.
   * @throws when the bot cannot start a session on it; nothing is created then.
   */
  model(botId: string, request: BotSessionModelRequest): Promise<SessionModel>
  /**
   * Create and publish the session's Agent in `cwd` under `agentPreset` on
   * `model` (`agents.create` with the session controller's setup: model
   * selection and `agentPresets.mount`). Resolves to the session id and the mounted preset.
   */
  create(request: {
    cwd: string
    agentPreset: string
    model: SessionModel
  }): Promise<{ sessionId: string; agentPreset: string }>
  /** Record the session as the bot's (and whether its Main session started it). */
  adopt(botId: string, sessionId: string, membership: SessionMembership): Promise<unknown>
  /** Prepare the recorded session in the background (its environment answers before it takes input). */
  prepare(sessionId: string): void
  /** Give the session a user-owned title. */
  rename(sessionId: string, title: string): Promise<void>
  warn(message: string): void
}

const MAIN_MODEL: BotSessionModelRequest = Object.freeze({ role: "main" })

/** Thrown while a bot's preset is not ready; nothing was created. */
export class BotPresetNotReadyError extends Error {
  constructor(botId: string, problem: string) {
    super(`bot "${botId}" cannot start a session: its Agent preset is not ready: ${problem}`)
    this.name = "BotPresetNotReadyError"
  }
}

export function createBotSessions(deps: BotSessionDeps) {
  return {
    /**
     * Create a session in the environment's workspace under the bot's
     * composed preset, and record it as the bot's.
     * A title is best effort: failing to set it only warns.
     * @throws {BotPresetNotReadyError} while the preset is not ready, and
     *   the model's refusal when DSH cannot run the bot's main model.
     */
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
        // Recorded first: the session is the bot's even if it is not what was asked for.
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
