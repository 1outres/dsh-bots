import type {
  BotActivity,
  BotAttachmentCapability,
  BotDeliveryMode,
  BotDeliveryResult,
} from "../../channel-contract"
import type { ComposedPrompt, InboundContent, PromptPart } from "./inbound"

export interface MainInputSource {
  readonly id: string
  readonly attachments: BotAttachmentCapability | undefined
}

export interface MainDeliveryDeps {
  activityOf(sessionId: string): BotActivity
  busyMode(): BotDeliveryMode
  compose(
    request: {
      readonly botId: string
      readonly source: MainInputSource
      readonly content: InboundContent
      readonly header: string | undefined
    },
    signal: AbortSignal,
  ): Promise<ComposedPrompt>
  prompt(
    request: {
      botId: string
      sessionId: string
      content: readonly PromptPart[]
      mode: BotDeliveryMode
    },
    signal: AbortSignal,
  ): Promise<void>
  admit<T>(botId: string, work: (sessionId: string | undefined) => Promise<T>): Promise<T>
  shield(botId: string, sessionId: string, content: InboundContent): Promise<InboundContent>
}

export interface MainDeliveryRequest {
  readonly botId: string
  readonly source: MainInputSource
  readonly header: string | undefined
  readonly content: InboundContent
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))
const CLOSED = "The connection is closing."

const closed = (): BotDeliveryResult => ({
  delivered: false,
  failure: { code: "closed", message: CLOSED },
})

export function deliverToMain(
  deps: MainDeliveryDeps,
  request: MainDeliveryRequest,
  signal: AbortSignal,
): Promise<BotDeliveryResult> {
  const { botId, source, header } = request
  if (signal.aborted) return Promise.resolve(closed())
  return deps.admit(botId, async (sessionId): Promise<BotDeliveryResult> => {
    if (signal.aborted) return closed()
    if (sessionId === undefined) {
      return {
        delivered: false,
        failure: { code: "no-main-session", message: "The bot has no Main session yet." },
      }
    }
    const content = await deps.shield(botId, sessionId, request.content)
    let composed: ComposedPrompt
    try {
      composed = await deps.compose({ botId, source, content, header }, signal)
    } catch (error) {
      if (signal.aborted) return closed()
      throw error
    }
    if (!composed.ok) return { delivered: false, failure: composed.failure }
    const mode: BotDeliveryMode =
      deps.activityOf(sessionId) === "running" ? deps.busyMode() : "queue"
    try {
      await deps.prompt({ botId, sessionId, content: composed.content, mode }, signal)
    } catch (error) {
      if (signal.aborted) return closed()
      return { delivered: false, failure: { code: "rejected", message: messageOf(error) } }
    }
    return {
      delivered: true,
      receipt: { sessionId, mode, images: composed.images, saved: composed.saved },
    }
  })
}
