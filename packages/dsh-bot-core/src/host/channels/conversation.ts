import type {
  BotActivity,
  BotAnswerResult,
  BotChannelCapabilities,
  BotCommandId,
  BotCommandOutcome,
  BotDeliveryMode,
  BotDeliveryResult,
  BotInboundMessage,
  BotInteractionAnswer,
} from "../../channel-contract"
import type { InteractionBoard } from "../interactions/board"
import { BOT_COMMANDS } from "./capabilities"
import { messageHeader } from "./header"
import type { ComposedPrompt, PromptPart } from "./inbound"

export interface ConversationDeps {
  /** The bot's Main session, if it has one. */
  mainSessionOf(botId: string): string | undefined
  /** Whether the session's live Agent runs a turn (idle without a live Agent). */
  activityOf(sessionId: string): BotActivity
  /** DSH's composer preference for a plain Enter while a turn runs. */
  busyMode(): BotDeliveryMode
  /** The prompt content a message makes (host/channels/inbound.ts). */
  compose(
    request: {
      readonly botId: string
      readonly channelId: string
      readonly capabilities: BotChannelCapabilities
      readonly message: BotInboundMessage
      readonly header: string
    },
    signal: AbortSignal,
  ): Promise<ComposedPrompt>
  /** DSH's `session.prompt`, as the Web composer calls it, in the bot's time zone. */
  prompt(
    request: {
      botId: string
      sessionId: string
      content: readonly PromptPart[]
      mode: BotDeliveryMode
    },
    signal: AbortSignal,
  ): Promise<void>
  run(botId: string, command: BotCommandId): Promise<BotCommandOutcome>
  interactions: Pick<InteractionBoard, "answer" | "hold">
  /**
   * Hand an input to the bot's Main (host/mains/controller.ts `admit`): runs
   * `work` with the Main it goes to once no maintenance holds the bot.
   */
  admit<T>(botId: string, work: (sessionId: string | undefined) => Promise<T>): Promise<T>
  /**
   * A person's message with the bot's secrets withheld before the bot reads it
   * (recorded as an incident; docs/specs/bot-vaults.md §7.2).
   * @throws when the vault guard cannot check it: it is not delivered.
   */
  shield(botId: string, sessionId: string, message: BotInboundMessage): Promise<BotInboundMessage>
}

/** A bot's Main session as one channel connection's inputs reach it. */
export interface MainConversation {
  deliver(message: BotInboundMessage): Promise<BotDeliveryResult>
  run(command: BotCommandId, person: string): Promise<BotCommandOutcome>
  answer(interactionId: string, answer: BotInteractionAnswer): Promise<BotAnswerResult>
  hold(interactionId: string): Promise<BotAnswerResult>
  activity(): BotActivity
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const CLOSED = "The connection is closing."

export function openMainConversation(
  deps: ConversationDeps,
  target: {
    readonly botId: string
    readonly channel: { readonly id: string; readonly name: string }
    readonly capabilities: BotChannelCapabilities
    /** The channel's ids of the bot's owners there. */
    readonly owners: ReadonlySet<string>
  },
  signal: AbortSignal,
): MainConversation {
  const { botId, capabilities, owners } = target
  const channelId = target.channel.id
  const deliverTo = async (
    sessionId: string | undefined,
    message: BotInboundMessage,
  ): Promise<BotDeliveryResult> => {
    if (signal.aborted) return { delivered: false, failure: { code: "closed", message: CLOSED } }
    if (sessionId === undefined) {
      return {
        delivered: false,
        failure: { code: "no-main-session", message: "The bot has no Main session yet." },
      }
    }
    const shielded = await deps.shield(botId, sessionId, message)
    let composed: ComposedPrompt
    try {
      const header = messageHeader({
        channel: target.channel.name,
        place: message.place,
        sender: message.sender,
        owner: owners.has(message.sender.id),
      })
      composed = await deps.compose(
        { botId, channelId, capabilities, message: shielded, header },
        signal,
      )
    } catch (error) {
      if (signal.aborted) return { delivered: false, failure: { code: "closed", message: CLOSED } }
      throw error
    }
    if (!composed.ok) return { delivered: false, failure: composed.failure }
    const mode: BotDeliveryMode =
      deps.activityOf(sessionId) === "running" ? deps.busyMode() : "queue"
    try {
      await deps.prompt({ botId, sessionId, content: composed.content, mode }, signal)
    } catch (error) {
      if (signal.aborted) return { delivered: false, failure: { code: "closed", message: CLOSED } }
      return { delivered: false, failure: { code: "rejected", message: messageOf(error) } }
    }
    return {
      delivered: true,
      receipt: { sessionId, mode, images: composed.images, saved: composed.saved },
    }
  }
  return {
    async deliver(message) {
      if (signal.aborted) return { delivered: false, failure: { code: "closed", message: CLOSED } }
      return deps.admit(botId, (sessionId) => deliverTo(sessionId, message))
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
