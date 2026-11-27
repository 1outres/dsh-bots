import type {
  BotActivity,
  BotAnswerResult,
  BotChannelCapabilities,
  BotCommandId,
  BotCommandOutcome,
  BotDeliveryResult,
  BotInboundMessage,
  BotInteractionAnswer,
} from "../../channel-contract"
import type { InteractionBoard } from "../interactions/board"
import { BOT_COMMANDS } from "./capabilities"
import { deliverToMain, type MainDeliveryDeps } from "./delivery"
import { messageHeader } from "./header"

export interface ConversationDeps extends MainDeliveryDeps {
  mainSessionOf(botId: string): string | undefined
  run(botId: string, command: BotCommandId): Promise<BotCommandOutcome>
  interactions: Pick<InteractionBoard, "answer" | "hold">
}

export interface MainConversation {
  deliver(message: BotInboundMessage): Promise<BotDeliveryResult>
  run(command: BotCommandId, person: string): Promise<BotCommandOutcome>
  answer(interactionId: string, answer: BotInteractionAnswer): Promise<BotAnswerResult>
  hold(interactionId: string): Promise<BotAnswerResult>
  activity(): BotActivity
}

const CLOSED = "The connection is closing."

export function openMainConversation(
  deps: ConversationDeps,
  target: {
    readonly botId: string
    readonly channel: { readonly id: string; readonly name: string }
    readonly capabilities: BotChannelCapabilities
    readonly owners: ReadonlySet<string>
  },
  signal: AbortSignal,
): MainConversation {
  const { botId, capabilities, owners } = target
  const channelId = target.channel.id
  const source = { id: channelId, attachments: capabilities.attachments }
  return {
    deliver(message) {
      const header = messageHeader({
        channel: target.channel.name,
        place: message.place,
        sender: message.sender,
        owner: owners.has(message.sender.id),
      })
      return deliverToMain(deps, { botId, source, header, content: message }, signal)
    },
    async run(command, person) {
      if (signal.aborted) return { ok: false, message: CLOSED }
      const spec = BOT_COMMANDS.find((known) => known.id === command)
      if (spec === undefined || !capabilities.commands.includes(command)) {
        return { ok: false, message: `This channel does not offer "${command}".` }
      }
      if (spec.access === "owners" && !owners.has(person)) {
        return { ok: false, message: `Only the bot's owners may use "${command}".` }
      }
      return deps.run(botId, command)
    },
    async answer(interactionId, answer) {
      if (signal.aborted) return { accepted: false, reason: "closed", message: CLOSED }
      if (!capabilities.interactions.includes(answer.kind)) {
        return {
          accepted: false,
          reason: "invalid",
          message: `This channel does not take ${answer.kind} answers.`,
        }
      }
      return deps.interactions.answer({ kind: "main", botId }, interactionId, answer, {
        via: "channel",
        channelId,
      })
    },
    async hold(interactionId) {
      if (signal.aborted) return { accepted: false, reason: "closed", message: CLOSED }
      return deps.interactions.hold({ kind: "main", botId }, interactionId)
    },
    activity() {
      const sessionId = deps.mainSessionOf(botId)
      return sessionId === undefined ? "idle" : deps.activityOf(sessionId)
    },
  }
}
