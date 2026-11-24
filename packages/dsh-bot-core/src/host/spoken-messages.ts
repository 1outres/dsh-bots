/**
 * What people and the bot said in a session's messages: a person's message
 * (source `user`: the owner in the Web UI, or a channel's message with its
 * header line) and the bot's reply, with the names of the tools it called.
 * Tool results, notices, relays and instructions are not spoken messages.
 */
import { counted } from "./plural"

/** A session's message (dsh-llm `Message`), as far as read here. */
export interface TranscriptMessage {
  readonly id: string
  readonly role: string
  readonly content: readonly {
    readonly type: string
    readonly text?: string
    readonly name?: string
  }[]
  readonly source: { readonly kind: string; readonly form?: string; readonly summary?: string }
}

export type Speaker = "person" | "bot"

export interface SpokenMessage {
  readonly id: string
  readonly speaker: Speaker
  /** The message's text blocks, trimmed, one per line. */
  readonly text: string
  readonly images: number
  /** The tools a reply called, in order. */
  readonly tools: readonly string[]
}

/** The trimmed, non-empty text blocks of a message. */
export const textsOf = (message: TranscriptMessage): readonly string[] =>
  message.content.flatMap((block) =>
    block.type === "text" && typeof block.text === "string" && block.text.trim() !== ""
      ? [block.text.trim()]
      : [],
  )

/** The message as spoken, or undefined when it is not a person's or a reply with nothing in it. */
export function spokenMessageOf(message: TranscriptMessage): SpokenMessage | undefined {
  if (message.role === "assistant") {
    const text = textsOf(message).join("\n")
    const tools = message.content.flatMap((block) =>
      block.type === "tool-call" && typeof block.name === "string" ? [block.name] : [],
    )
    return text === "" && tools.length === 0
      ? undefined
      : { id: message.id, speaker: "bot", text, images: 0, tools }
  }
  if (message.role !== "user" || message.source.kind !== "user") return undefined
  return {
    id: message.id,
    speaker: "person",
    text: textsOf(message).join("\n"),
    images: message.content.filter((block) => block.type === "image").length,
    tools: [],
  }
}

/** The text, then what is only named: the images and the tools called. */
export function spokenLines(spoken: SpokenMessage): readonly string[] {
  return [
    ...(spoken.text === "" ? [] : [spoken.text]),
    ...(spoken.images === 0
      ? []
      : [`[${counted(spoken.images, { one: "image", other: "images" })}]`]),
    ...(spoken.tools.length === 0 ? [] : [`[called: ${spoken.tools.join(", ")}]`]),
  ]
}
