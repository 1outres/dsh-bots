import type { BotMessagePlace, BotMessageSender } from "../../channel-contract"
import { oneLine } from "../one-line"

/** What a message header states: the channel, the place, the sender and whether bot-core counts them as an owner. */
export interface MessageOrigin {
  readonly channel: string
  readonly place: BotMessagePlace
  readonly sender: BotMessageSender
  readonly owner: boolean
}

/**
 * A name from outside on one line, without the characters a header is built
 * from, so a name cannot close the header early or claim a role. Lookalike
 * forms (fullwidth brackets…) are folded first.
 */
export function headerName(text: string): string {
  return oneLine(text.normalize("NFKC"))
    .replace(/[[\]()·]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
}

/** A handle as {@link headerName}, also without commas, "@" and spaces, which would let it add a mark. */
export function headerHandle(text: string): string {
  return headerName(text).replace(/[,@\s]/gu, "")
}

function placeOf(place: BotMessagePlace): string {
  switch (place.kind) {
    case "direct":
      return "DM"
  }
}

const HEADER = /^\[[^[\]]* · [^[\]]* · [^[\]()]*\(([^()[\]]*)\)\]$/u

/**
 * Who wrote a prompt's text, read back from its first line: a channel message
 * starts with the header bot-core wrote (and nobody else can, see
 * {@link messageHeader}), so a text without one was written in the Web UI,
 * by the owner. `body` is the text without the header.
 */
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

/** The line a channel message starts with: `[Discord · DM · Alice (@alice, owner)]`. */
export function messageHeader(origin: MessageOrigin): string {
  const { sender } = origin
  const marks = [
    `@${headerHandle(sender.handle)}`,
    ...(origin.owner ? ["owner"] : []),
    ...(sender.bot ? ["bot"] : []),
  ]
  return `[${[headerName(origin.channel), placeOf(origin.place), `${headerName(sender.displayName)} (${marks.join(", ")})`].join(" · ")}]`
}
