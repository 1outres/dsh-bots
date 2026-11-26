import type {
  BotAnswerResult,
  BotInteraction,
  BotInteractionAnswer,
  BotInteractionsSnapshot,
  BotOpenInteraction,
} from "../../shared/interactions"
import type { InteractionBoard } from "./board"

export interface InteractionPanelDeps {
  board: Pick<InteractionBoard, "openIn" | "closedIn" | "answer" | "hold">
  isBotSession(sessionId: string): boolean
  channelName(channelId: string): string | undefined
  now(): number
}

export interface InteractionPanel {
  snapshot(sessionId: string): BotInteractionsSnapshot
  answer(
    sessionId: string,
    interactionId: string,
    answer: BotInteractionAnswer,
  ): Promise<BotAnswerResult>
  hold(sessionId: string, interactionId: string): Promise<BotAnswerResult>
}

export function createInteractionPanel(deps: InteractionPanelDeps): InteractionPanel {
  const requireBotSession = (sessionId: string) => {
    if (!deps.isBotSession(sessionId))
      throw new Error(`session "${sessionId}" is not a bot session`)
  }
  const viewOf = (interaction: BotInteraction): BotOpenInteraction =>
    interaction.kind === "question" && interaction.wait?.state === "counting"
      ? { interaction, remainingMs: Math.max(0, interaction.wait.deadline - deps.now()) }
      : { interaction }
  return {
    snapshot(sessionId) {
      requireBotSession(sessionId)
      const closed = deps.board.closedIn(sessionId)
      const channelNames: Record<string, string> = {}
      for (const { resolution } of closed) {
        if (resolution.kind !== "answered" || resolution.by.via !== "channel") continue
        const { channelId } = resolution.by
        channelNames[channelId] = deps.channelName(channelId) ?? channelId
      }
      return { sessionId, open: deps.board.openIn(sessionId).map(viewOf), closed, channelNames }
    },
    async answer(sessionId, interactionId, answer) {
      requireBotSession(sessionId)
      return deps.board.answer({ kind: "session", sessionId }, interactionId, answer, {
        via: "web",
      })
    },
    async hold(sessionId, interactionId) {
      requireBotSession(sessionId)
      return deps.board.hold({ kind: "session", sessionId }, interactionId)
    },
  }
}
