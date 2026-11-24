import type { BotManagedTarget } from "../../shared/managed-sessions"
import { headerName } from "../channels/header"

/** The message source of what the Main session sends a managed session (declared on dsh-llm's MessageSourceMap in src/index.ts). */
export const MAIN_MESSAGE_SOURCE = "bot-main-relay"

/** The first line of every message the Main session sends one of its bot's sessions. */
export const MAIN_MESSAGE_LEAD = "Your Main session sent a message:"

/**
 * The first line of every message a bot's Main session sends a DSH Workspace
 * session: that session knows no bot, so the line names it.
 */
export function workspaceMessageLead(botName: string): string {
  return `Bot "${headerName(botName)}", which your owner lets manage this session, sent a message:`
}

/** The first line of the Main session's messages to a session of `target`. */
export function mainMessageLead(target: BotManagedTarget, botName: string): string {
  return target.kind === "bot" ? MAIN_MESSAGE_LEAD : workspaceMessageLead(botName)
}

/** A message of the Main session as a managed session takes it: a relay, as DSH's `send_message` makes one. */
export interface MainMessage {
  readonly content: readonly [
    { readonly type: "text"; readonly text: string },
    { readonly type: "text"; readonly text: string },
  ]
  readonly source: { readonly kind: typeof MAIN_MESSAGE_SOURCE; readonly form: "relay" }
}

export function mainMessage(text: string, lead: string): MainMessage {
  return {
    content: [
      { type: "text", text: lead },
      { type: "text", text },
    ],
    source: { kind: MAIN_MESSAGE_SOURCE, form: "relay" },
  }
}
