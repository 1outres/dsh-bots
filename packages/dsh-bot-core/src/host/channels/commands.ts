import type {
  BotActivity,
  BotCommandId,
  BotCommandOutcome,
  BotConversationStatus,
} from "../../channel-contract"
import type { MainRotationOutcome } from "../../shared/mains"

/** A live Main session Agent, as the commands read it. */
export interface MainAgentView {
  readonly activity: BotActivity
  readonly model?: BotConversationStatus["model"]
  /** People's messages in its inbox (next turn and next step). */
  readonly queued: number
}

export interface CommandDeps {
  mainSessionOf(botId: string): string | undefined
  /** The session's live Agent; undefined until it is resumed. */
  agentOf(sessionId: string): MainAgentView | undefined
  /** DSH's `session.cancel`: the Web UI's stop (the turn ends, its inbox stays). */
  cancel(sessionId: string): Promise<void>
  /** The owner starts a new Main (host/mains/controller.ts `startNew`). */
  startNew(botId: string): Promise<MainRotationOutcome>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The channel-independent operations behind every channel's commands. */
export function createCommandRunner(deps: CommandDeps): {
  run(botId: string, command: BotCommandId): Promise<BotCommandOutcome>
} {
  const status = (sessionId: string): BotConversationStatus => {
    const agent = deps.agentOf(sessionId)
    if (agent === undefined) return { activity: "idle", loaded: false, queued: 0 }
    return {
      activity: agent.activity,
      loaded: true,
      ...(agent.model === undefined ? {} : { model: agent.model }),
      queued: agent.queued,
    }
  }
  return {
    async run(botId, command) {
      const sessionId = deps.mainSessionOf(botId)
      if (sessionId === undefined) return { ok: false, message: "The bot has no Main session yet." }
      switch (command) {
        case "status":
          return { ok: true, result: { command, status: status(sessionId) } }
        case "stop": {
          if (deps.agentOf(sessionId)?.activity !== "running") {
            return { ok: true, result: { command, outcome: "idle" } }
          }
          try {
            await deps.cancel(sessionId)
          } catch (error) {
            return { ok: false, message: `The turn could not be stopped: ${messageOf(error)}` }
          }
          return { ok: true, result: { command, outcome: "stopped" } }
        }
        case "new": {
          let rotation: MainRotationOutcome
          try {
            rotation = await deps.startNew(botId)
          } catch (error) {
            return { ok: false, message: `A new Main session could not start: ${messageOf(error)}` }
          }
          return rotation.outcome === "refused"
            ? { ok: false, message: rotation.message }
            : { ok: true, result: { command, outcome: rotation.outcome } }
        }
      }
    },
  }
}
