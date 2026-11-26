import type { BotMessagePlace, BotMessageSender } from "../../channel-contract"
import { oneLine } from "../one-line"

export interface MessageOrigin {
  readonly channel: string
  readonly place: BotMessagePlace
  readonly sender: BotMessageSender
  readonly owner: boolean
}

export function headerName(text: string): string {
  return oneLine(text.normalize("NFKC"))
    .replace(/[[\]()·]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
}

export function headerHandle(text: string): string {
  return headerName(text).replace(/[,@\s]/gu, "")
}

function placeOf(place: BotMessagePlace): string {
  switch (place.kind) {
    case "direct":
      return "DM"
    case "channel":
      return `#${headerName(place.channel)} (${headerName(place.server)})`
  }
}

const HEADER = /^\[[^[\]]* · [^[\]]* · [^[\]()]*\(([^()[\]]*)\)\]$/u

export function authorshipOf(text: string): { readonly owner: boolean; readonly body: string } {
  const newline = text.indexOf("\n")
  const first = newline === -1 ? text : text.slice(0, newline)
  const header = HEADER.exec(first)
  if (header === null) return { owner: true, body: text }
  return {
    owner: (header[1] as string).split(", ").includes("owner"),
    body: newline === -1 ? "" : text.slice(newline + 1),
  }
}

export function messageHeader(origin: MessageOrigin): string {
  const { sender } = origin
  const marks = [
    `@${headerHandle(sender.handle)}`,
    ...(origin.owner ? ["owner"] : []),
    ...(sender.bot ? ["bot"] : []),
  ]
  return `[${[headerName(origin.channel), placeOf(origin.place), `${headerName(sender.displayName)} (${marks.join(", ")})`].join(" · ")}]`
}
