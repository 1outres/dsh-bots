import type { BotChannelOutput, BotReply, BotTurnState } from "../../channel-contract"
import { type PresentedFile, type PresentedFiles, presentationOf } from "./presented"
import type { ChannelSequence } from "./sequence"

export interface AssistantBlock {
  readonly type: string
  readonly text?: string
}

export interface AssistantMessageData {
  readonly message: { readonly id: string; readonly content: readonly AssistantBlock[] }
  readonly interrupted?: true
}

export type TurnEndReason =
  | { readonly kind: "completed" }
  | { readonly kind: "aborted"; readonly reason: { readonly kind: string } }
  | { readonly kind: "blocked" }
  | { readonly kind: "error"; readonly error: { readonly message?: unknown } }
  | { readonly kind: "max-tokens" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "forked" }

export interface SessionEventLike {
  readonly type: string
  readonly data: unknown
}

export function replyOf(data: AssistantMessageData): BotReply | undefined {
  const text = data.message.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => (block.text as string).trim())
    .filter((part) => part.length > 0)
    .join("\n\n")
  if (text.length === 0) return undefined
  return { id: data.message.id, text, interrupted: data.interrupted === true }
}

export function endedTurnOf(reason: TurnEndReason): BotTurnState | undefined {
  switch (reason.kind) {
    case "completed":
      return { phase: "completed" }
    case "aborted":
      return { phase: "cancelled", by: reason.reason.kind === "user" ? "user" : "system" }
    case "blocked":
      return { phase: "failed", message: "A hook blocked the turn." }
    case "error": {
      const message = reason.error.message
      return {
        phase: "failed",
        message:
          typeof message === "string" && message.trim().length > 0
            ? message.trim()
            : "The turn failed.",
      }
    }
    case "max-tokens":
      return { phase: "failed", message: "The reply stopped at the model's output limit." }
    case "interrupted":
    case "forked":
      return undefined
  }
}

export function outputOf(event: SessionEventLike): BotChannelOutput | undefined {
  switch (event.type) {
    case "assistant/message": {
      const reply = replyOf(event.data as AssistantMessageData)
      return reply === undefined ? undefined : { kind: "reply", reply }
    }
    case "turn/start":
      return { kind: "turn", turn: { phase: "started" } }
    case "turn/end": {
      const turn = endedTurnOf((event.data as { readonly reason: TurnEndReason }).reason)
      return turn === undefined ? undefined : { kind: "turn", turn }
    }
    default:
      return undefined
  }
}

export function withheld(output: BotChannelOutput, silent: boolean): boolean {
  return silent && output.kind === "reply"
}

export interface MainFeedDeps {
  botOfMainSession(sessionId: string): string | undefined
  isSilent(sessionId: string): boolean
  isMaintenance(sessionId: string, event: SessionEventLike): boolean
  presented: PresentedFiles
  sequence: ChannelSequence
  deliverFiles(botId: string, files: readonly PresentedFile[]): Promise<void>
}

export function createMainFeed(deps: MainFeedDeps): {
  sessionEvent(sessionId: string, event: SessionEventLike): void
} {
  return {
    sessionEvent(sessionId, event) {
      const botId = deps.botOfMainSession(sessionId)
      if (botId === undefined || deps.isMaintenance(sessionId, event)) return
      const presentation = presentationOf(event)
      if (presentation !== undefined) {
        if (!deps.isSilent(sessionId)) deps.presented.record(sessionId, presentation)
        return
      }
      const output = outputOf(event)
      if (event.type === "turn/start") deps.presented.forget(sessionId)
      if (event.type === "turn/end") {
        const files = deps.presented.take(sessionId, (event.data as { readonly turn: number }).turn)
        if (output !== undefined && files.length > 0) {
          deps.sequence.run(botId, () => deps.deliverFiles(botId, files))
        }
      }
      if (output === undefined || withheld(output, deps.isSilent(sessionId))) return
      deps.sequence.publish(botId, output)
    },
  }
}
