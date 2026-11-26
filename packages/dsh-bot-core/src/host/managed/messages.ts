import type { BotManagedTarget } from "../../shared/managed-sessions"
import { headerName } from "../channels/header"

export const MAIN_MESSAGE_SOURCE = "bot-main-relay"

export const MAIN_MESSAGE_LEAD = "Your Main session sent a message:"

export function workspaceMessageLead(botName: string): string {
  return `Bot "${headerName(botName)}", which your owner lets manage this session, sent a message:`
}

export function mainMessageLead(target: BotManagedTarget, botName: string): string {
  return target.kind === "bot" ? MAIN_MESSAGE_LEAD : workspaceMessageLead(botName)
}

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
