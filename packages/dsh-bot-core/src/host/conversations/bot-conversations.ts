/**
 * What the conversations row asks the `bot` service
 * (src/plugins/conversations.ts). Only an Agent of the bot, asking with a token
 * of a revision registered during this load, is answered, and only in the
 * bot's conversations with its owner (Main and Web sessions;
 * docs/specs/bot-session-search.md §5). What it may read is decided from
 * bot-core's records, never from the call's arguments.
 */
import {
  type BotSessionKind,
  CONVERSATION_TOOL_NAMES,
  type ConversationToolRequest,
  type ConversationToolResponse,
} from "../../internal"
import { type KindAgent, type SessionKindDeps, sessionKindOf } from "../prompt/session-kind"
import type { ReviewSessions } from "../skills/review"
import { ConversationToolError } from "./errors"
import type { ConversationTools } from "./tools"

export interface BotConversationsDeps<A extends KindAgent> {
  /** Whether `token` is the token of a revision of the bot's preset registered during this load. */
  sealed(botId: string, token: string): boolean
  agent(agentId: string): A | undefined
  /** The bot the Agent's session verifiably belongs to (host/preset/identity.ts). */
  botOf(agent: A): string | undefined
  kind: SessionKindDeps
  /** The skill reviews running now: they see the tools of the session they review, and run none of them. */
  reviews: Pick<ReviewSessions, "get">
  tools: ConversationTools
}

/** Sessions that search the bot's past conversations (a review reads as the session it reviews). */
export const SEARCHING_SESSIONS: readonly BotSessionKind[] = ["main", "web"]

export interface BotConversations {
  available(botId: string, token: string, agentId: string): boolean
  call(
    botId: string,
    token: string,
    request: ConversationToolRequest,
    signal: AbortSignal,
  ): Promise<ConversationToolResponse>
}

export function createBotConversations<A extends KindAgent>(
  deps: BotConversationsDeps<A>,
): BotConversations {
  const kindOf = (botId: string, token: string, agentId: string): BotSessionKind => {
    if (!deps.sealed(botId, token)) {
      throw new Error(
        `bot-core: this preset revision of bot "${botId}" was not registered by this bot-core`,
      )
    }
    const agent = deps.agent(agentId)
    if (agent === undefined || deps.botOf(agent) !== botId) {
      throw new Error(`bot-core: Agent "${agentId}" does not run a session of bot "${botId}"`)
    }
    return sessionKindOf(deps.kind, botId, agent)
  }

  return {
    available(botId, token, agentId) {
      try {
        return SEARCHING_SESSIONS.includes(kindOf(botId, token, agentId))
      } catch {
        return false
      }
    },
    async call(botId, token, request, signal) {
      const kind = kindOf(botId, token, request.agentId)
      if (deps.reviews.get(request.agentId) !== undefined) {
        throw new ConversationToolError("a background skill review runs skill_manage only")
      }
      if (!SEARCHING_SESSIONS.includes(kind)) {
        throw new ConversationToolError(
          "your past conversations with your owner can be searched only in your Main session and in the sessions your owner opens",
        )
      }
      if (!CONVERSATION_TOOL_NAMES.includes(request.tool)) {
        throw new ConversationToolError(`unknown conversation tool ${request.tool}`)
      }
      const text = await deps.tools.call(
        { botId, callerId: request.agentId, tool: request.tool, args: request.args },
        signal,
      )
      return { text }
    },
  }
}
