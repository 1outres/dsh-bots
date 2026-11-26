import type { BotQuestion } from "@1outres/dsh-bot-core"

export type ReplyAnswer =
  | { readonly kind: "choose"; readonly labels: readonly string[] }
  | { readonly kind: "skip" }
  | { readonly kind: "write"; readonly text: string }

const NUMBERS = /^\s*\d+(\s*[,、 ]\s*\d+)*\s*$/

export function replyAnswer(question: BotQuestion, text: string): ReplyAnswer | undefined {
  const trimmed = text.trim()
  if (trimmed === "") return undefined
  if (trimmed === "-") return { kind: "skip" }
  if (question.options.length > 0 && NUMBERS.test(trimmed)) {
    const picked = [...new Set(trimmed.split(/[,、 ]+/).map((part) => Number(part)))]
    const labels = picked.flatMap((number) => {
      const option = question.options[number - 1]
      return option === undefined ? [] : [option.label]
    })
    if (labels.length === picked.length && (question.multiSelect || labels.length === 1)) {
      return { kind: "choose", labels }
    }
  }
  return { kind: "write", text: trimmed }
}
