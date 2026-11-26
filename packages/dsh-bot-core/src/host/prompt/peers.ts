import type { BotPeerFact, BotPeerFacts, BotPeerMachine } from "../../internal"
import { headerName } from "../channels/header"

const MACHINE_TEXT: Readonly<Record<BotPeerMachine, string>> = {
  ready: "Ready.",
  starting: "Its machine is starting.",
  stopped: "Its machine is stopped; messages wait for it for up to 24 hours.",
}

const GROUP_PAUSE_TEXT: Readonly<Record<NonNullable<BotPeerFacts["paused"]>, string>> = {
  owner: "- Messages in this group are paused by your owner.",
  limit: "- Messages in this group are paused after too many messages; your owner can resume them.",
}

export const NO_PEERS = "- No other bots are in this group yet."

export const MAIN_ONLY = "- You can message them only from your Main session."

function clause(text: string): string {
  return headerName(text).replace(/\.+$/u, "")
}

export function clockTime(at: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value as string
  return `${part("hour")}:${part("minute")}`
}

function peerLine(peer: BotPeerFact): string {
  const role = clause(peer.role)
  return `- ${headerName(peer.name)} (bot ${peer.botId}): ${role === "" ? "no role given" : role}. ${MACHINE_TEXT[peer.machine]}`
}

function pauseLine(peer: BotPeerFact, timezone: string): string[] {
  return peer.pausedUntil === undefined
    ? []
    : [
        `- Messages between you and ${headerName(peer.name)} are paused until ${clockTime(peer.pausedUntil, timezone)}.`,
      ]
}

export interface PeerGroupView {
  readonly mainSession: boolean
}

export function renderPeerGroup(facts: BotPeerFacts, view: PeerGroupView): string {
  const purpose = clause(facts.purpose)
  const role = clause(facts.role)
  return [
    `Peer bots (group "${headerName(facts.group)}"):`,
    `- Purpose: ${purpose === "" ? "none given" : purpose}.`,
    `- Your role: ${role === "" ? "none given" : role}.`,
    ...(facts.peers.length === 0 ? [NO_PEERS] : facts.peers.map(peerLine)),
    ...facts.peers.flatMap((peer) => pauseLine(peer, facts.timezone)),
    ...(facts.paused === undefined ? [] : [GROUP_PAUSE_TEXT[facts.paused]]),
    ...(view.mainSession ? [] : [MAIN_ONLY]),
  ].join("\n")
}
