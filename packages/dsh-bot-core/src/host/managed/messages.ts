import type { BotManagedTarget } from "../../shared/managed-sessions"
import { headerName } from "../channels/header"

export const MAIN_MESSAGE_SOURCE = "bot-main-relay"

export const PEER_RELAY_SOURCE = "bot-peer-relay"

export const MAIN_MESSAGE_SOURCES: readonly string[] = [MAIN_MESSAGE_SOURCE, PEER_RELAY_SOURCE]

export const MAIN_MESSAGE_LEAD = "Your Main session sent a message:"

export const UNNAMED_PEER_LEAD = "Your Main session sent a message for a peer bot:"

export function workspaceMessageLead(botName: string): string {
  return `Bot "${headerName(botName)}", which your owner lets manage this session, sent a message:`
}

export function peerMessageLead(peerName: string | undefined): string {
  return peerName === undefined
    ? UNNAMED_PEER_LEAD
    : `Your Main session sent a message for peer bot "${headerName(peerName)}":`
}

export interface PeerRelay {
  readonly peerMessages: readonly string[]
  readonly peerName: string | undefined
}

export function mainMessageLead(
  target: BotManagedTarget,
  botName: string,
  relay: PeerRelay | undefined,
): string {
  if (target.kind !== "bot") return workspaceMessageLead(botName)
  return relay === undefined ? MAIN_MESSAGE_LEAD : peerMessageLead(relay.peerName)
}

export type MainMessageSource =
  | { readonly kind: typeof MAIN_MESSAGE_SOURCE; readonly form: "relay" }
  | {
      readonly kind: typeof PEER_RELAY_SOURCE
      readonly form: "relay"
      readonly peerMessages: readonly string[]
    }

export interface MainMessage {
  readonly content: readonly [
    { readonly type: "text"; readonly text: string },
    { readonly type: "text"; readonly text: string },
  ]
  readonly source: MainMessageSource
}

export function mainMessage(text: string, lead: string, relay?: PeerRelay): MainMessage {
  return {
    content: [
      { type: "text", text: lead },
      { type: "text", text },
    ],
    source:
      relay === undefined
        ? { kind: MAIN_MESSAGE_SOURCE, form: "relay" }
        : { kind: PEER_RELAY_SOURCE, form: "relay", peerMessages: [...relay.peerMessages] },
  }
}
