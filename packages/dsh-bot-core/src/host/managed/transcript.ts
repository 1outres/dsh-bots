import type { BotInteraction } from "../../shared/interactions"
import { counted } from "../plural"
import { spokenLines, spokenMessageOf, type TranscriptMessage, textsOf } from "../spoken-messages"
import { MAIN_MESSAGE_SOURCES } from "./messages"

export type TranscriptSpeaker = "owner" | "main" | "notice" | "assistant"

export interface TranscriptEntry {
  readonly id: string
  readonly speaker: TranscriptSpeaker
  readonly text: string
}

export interface Transcript {
  readonly entries: readonly TranscriptEntry[]
  readonly omitted: number
  readonly cursor: string | undefined
}

export const ENTRY_MAX_CHARS = 2000

const clip = (text: string) =>
  text.length > ENTRY_MAX_CHARS ? `${text.slice(0, ENTRY_MAX_CHARS)}… [cut]` : text

const SPOKEN_SPEAKERS = { person: "owner", bot: "assistant" } as const

function entryOf(message: TranscriptMessage): TranscriptEntry | undefined {
  const spoken = spokenMessageOf(message)
  if (spoken !== undefined) {
    return {
      id: message.id,
      speaker: SPOKEN_SPEAKERS[spoken.speaker],
      text: clip(spokenLines(spoken).join("\n")),
    }
  }
  if (message.role !== "user") return undefined
  const { source } = message
  if (MAIN_MESSAGE_SOURCES.includes(source.kind)) {
    const [, ...body] = textsOf(message)
    return { id: message.id, speaker: "main", text: clip(body.join("\n")) }
  }
  if (source.form === "notice" && typeof source.summary === "string") {
    return { id: message.id, speaker: "notice", text: source.summary }
  }
  return undefined
}

export function transcriptOf(
  messages: readonly TranscriptMessage[],
  options: { readonly after?: string; readonly limit: number },
): Transcript {
  let start = 0
  if (options.after !== undefined) {
    const at = messages.findIndex((message) => message.id === options.after)
    if (at < 0) throw new Error(`after: "${options.after}" is not a message of this session`)
    start = at + 1
  }
  const entries = messages.slice(start).flatMap((message) => entryOf(message) ?? [])
  const kept = entries.slice(-options.limit)
  return {
    entries: kept,
    omitted: entries.length - kept.length,
    cursor: messages.at(-1)?.id ?? options.after,
  }
}

export function describeInteraction(interaction: BotInteraction): string {
  switch (interaction.kind) {
    case "question":
      return [
        `- interaction ${interaction.id}: questions`,
        ...interaction.questions.map((question) => {
          const options = question.options.map((option) => option.label).join(" | ")
          return `  - [${question.id}] ${question.question}${options === "" ? "" : ` (options: ${options}${question.multiSelect ? "; several allowed" : ""})`}`
        }),
      ].join("\n")
    case "plan-review":
      return `- interaction ${interaction.id}: plan review — ${interaction.question}\n${clip(interaction.plan)}`
    case "approval":
      return `- interaction ${interaction.id}: approval (your owner answers it in the Web UI)`
  }
}

const SPEAKERS: { readonly [Speaker in TranscriptSpeaker]: string } = {
  owner: "owner",
  main: "you (Main)",
  notice: "notice",
  assistant: "session",
}

export function renderTranscript(transcript: Transcript): string {
  const lines = transcript.entries.map(
    (entry) => `--- ${SPEAKERS[entry.speaker]} [${entry.id}]\n${entry.text}`,
  )
  return [
    ...(transcript.omitted > 0
      ? [
          `(${counted(transcript.omitted, { one: "earlier message", other: "earlier messages" })} left out)`,
        ]
      : []),
    ...(lines.length === 0 ? ["(no new messages)"] : lines),
  ].join("\n")
}
