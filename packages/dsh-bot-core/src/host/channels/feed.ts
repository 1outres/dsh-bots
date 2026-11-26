import type { BotChannelOutput, BotReply, BotTurnState } from "../../channel-contract"
import type { HeldReplies } from "./held-replies"
import { type PresentedFile, type PresentedFiles, presentationOf } from "./presented"
import type { ChannelSequence } from "./sequence"
import { silencerCallsOf } from "./stay-silent"

export interface AssistantBlock {
  readonly type: string
  readonly text?: string
  readonly id?: string
  readonly name?: string
}

export interface AssistantMessage {
  readonly id: string
  readonly content: readonly AssistantBlock[]
}

export interface AssistantMessageData {
  readonly turn: number
  readonly message: AssistantMessage
  readonly interrupted?: true
}

export interface ToolResultData {
  readonly turn: number
  readonly message: { readonly toolCallId: string; readonly isError: boolean }
}

export type TurnEndReason =
  | { readonly kind: "completed" }
  | { readonly kind: "aborted"; readonly reason: { readonly kind: string } }
  | { readonly kind: "blocked" }
  | { readonly kind: "error"; readonly error: { readonly message?: unknown } }
  | { readonly kind: "max-tokens" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "forked" }

export interface TurnEndData {
  readonly turn: number
  readonly reason: TurnEndReason
}

export interface SessionEventLike {
  readonly type: string
  readonly data: unknown
}

export function replyOf(
  data: Pick<AssistantMessageData, "message" | "interrupted">,
): BotReply | undefined {
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

export interface MainFeedDeps {
  botOfMainSession(sessionId: string): string | undefined
  isSilent(sessionId: string): boolean
  isMaintenance(sessionId: string, event: SessionEventLike): boolean
  presented: PresentedFiles
  held: HeldReplies
  sequence: ChannelSequence
  deliverFiles(botId: string, files: readonly PresentedFile[]): Promise<void>
}

export function createMainFeed(deps: MainFeedDeps): {
  sessionEvent(sessionId: string, event: SessionEventLike): void
} {
  const publish = (botId: string, output: BotChannelOutput) => deps.sequence.publish(botId, output)
  const publishReplies = (botId: string, replies: readonly BotReply[]) => {
    for (const reply of replies) publish(botId, { kind: "reply", reply })
  }

  const assistantMessage = (sessionId: string, botId: string, data: AssistantMessageData) => {
    if (deps.isSilent(sessionId)) return
    const reply = replyOf(data)
    if (reply === undefined) return
    const silencers = silencerCallsOf(data.message.content)
    publishReplies(botId, deps.held.offer(sessionId, data.turn, reply, silencers))
  }

  const toolResult = (sessionId: string, botId: string, data: ToolResultData) => {
    const outcome = { callId: data.message.toolCallId, silenced: !data.message.isError }
    publishReplies(botId, deps.held.settle(sessionId, data.turn, outcome))
  }

  const turnStart = (sessionId: string, botId: string) => {
    deps.presented.forget(sessionId)
    deps.held.forget(sessionId)
    publish(botId, { kind: "turn", turn: { phase: "started" } })
  }

  const turnEnd = (sessionId: string, botId: string, data: TurnEndData) => {
    const files = deps.presented.take(sessionId, data.turn)
    const replies = deps.held.flush(sessionId, data.turn)
    const turn = endedTurnOf(data.reason)
    if (turn === undefined) return
    publishReplies(botId, replies)
    if (files.length > 0) deps.sequence.run(botId, () => deps.deliverFiles(botId, files))
    publish(botId, { kind: "turn", turn })
  }

  return {
    sessionEvent(sessionId, event) {
      const botId = deps.botOfMainSession(sessionId)
      if (botId === undefined || deps.isMaintenance(sessionId, event)) return
      const presentation = presentationOf(event)
      if (presentation !== undefined) {
        if (!deps.isSilent(sessionId)) deps.presented.record(sessionId, presentation)
        return
      }
      switch (event.type) {
        case "assistant/message":
          return assistantMessage(sessionId, botId, event.data as AssistantMessageData)
        case "tool/result":
          return toolResult(sessionId, botId, event.data as ToolResultData)
        case "turn/start":
          return turnStart(sessionId, botId)
        case "turn/end":
          return turnEnd(sessionId, botId, event.data as TurnEndData)
      }
    },
  }
}
