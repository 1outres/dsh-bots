import type { BotChannelText } from "./channels"

export type BotInteractionKind = "question" | "approval" | "plan-review"

export const BOT_INTERACTION_KINDS: readonly BotInteractionKind[] = [
  "question",
  "approval",
  "plan-review",
]

export interface BotQuestionOption {
  readonly label: string
  readonly description?: string
}

export interface BotQuestion {
  readonly id: string
  readonly question: string
  readonly header?: string
  readonly detail?: string
  readonly options: readonly BotQuestionOption[]
  readonly multiSelect: boolean
}

export type BotQuestionWait =
  | { readonly state: "counting"; readonly deadline: number }
  | { readonly state: "held" }
  | { readonly state: "continued" }

export type BotApprovalAction = "allow-once" | "reject" | "always"

export interface BotQuestionInteraction {
  readonly id: string
  readonly kind: "question"
  readonly questions: readonly BotQuestion[]
  readonly wait?: BotQuestionWait
}

export interface BotApprovalInteraction {
  readonly id: string
  readonly kind: "approval"
  readonly subject?: string
  readonly question: BotChannelText
  readonly detail?: BotChannelText
  readonly actions: readonly BotApprovalAction[]
  readonly allowLabel?: BotChannelText
  readonly delegated: boolean
}

export interface BotPlanReviewInteraction {
  readonly id: string
  readonly kind: "plan-review"
  readonly question: string
  readonly plan: string
}

export type BotInteraction =
  | BotQuestionInteraction
  | BotApprovalInteraction
  | BotPlanReviewInteraction

export interface BotQuestionAnswer {
  readonly id: string
  readonly selected: readonly string[]
  readonly custom?: string
}

export type BotInteractionAnswer =
  | { readonly kind: "question"; readonly answers: readonly BotQuestionAnswer[] }
  | { readonly kind: "approval"; readonly action: BotApprovalAction }
  | { readonly kind: "plan-review"; readonly approved: boolean; readonly feedback?: string }

export type BotAnswerOrigin =
  | { readonly via: "web" }
  | { readonly via: "main" }
  | { readonly via: "channel"; readonly channelId: string }

export type BotInteractionResolution =
  | {
      readonly kind: "answered"
      readonly by: BotAnswerOrigin
      readonly answer: BotInteractionAnswer
    }
  | { readonly kind: "withdrawn" }

export interface BotInteractionClosure {
  readonly id: string
  readonly kind: BotInteractionKind
  readonly resolution: BotInteractionResolution
}

export type BotAnswerRefusal = "not-open" | "invalid" | "closed" | "failed"

export type BotAnswerResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: BotAnswerRefusal; readonly message: string }

export interface BotOpenInteraction {
  readonly interaction: BotInteraction
  readonly remainingMs?: number
}

export interface BotClosedInteraction {
  readonly interaction: BotInteraction
  readonly resolution: BotInteractionResolution
}

export interface BotInteractionsSnapshot {
  readonly sessionId: string
  readonly open: readonly BotOpenInteraction[]
  readonly closed: readonly BotClosedInteraction[]
  readonly channelNames: Readonly<Record<string, string>>
}

export interface BotInteractionsApi {
  watch(sessionId: string, signal?: AbortSignal): AsyncIterable<BotInteractionsSnapshot>
  answer(
    sessionId: string,
    interactionId: string,
    answer: BotInteractionAnswer,
  ): Promise<BotAnswerResult>
  hold(sessionId: string, interactionId: string): Promise<BotAnswerResult>
}

const hasText = (text: string | undefined): boolean => text !== undefined && text.trim().length > 0

function questionProblem(question: BotQuestion, answer: BotQuestionAnswer): string | undefined {
  const labels = new Set(question.options.map((option) => option.label))
  if (new Set(answer.selected).size !== answer.selected.length) {
    return `question "${question.id}" names a choice twice`
  }
  const unknown = answer.selected.find((label) => !labels.has(label))
  if (unknown !== undefined) return `"${unknown}" is not a choice of question "${question.id}"`
  if (answer.custom !== undefined && !hasText(answer.custom)) {
    return `the text answer of question "${question.id}" is empty`
  }
  if (!question.multiSelect) {
    if (answer.selected.length > 1) return `question "${question.id}" takes one choice`
    if (answer.custom !== undefined && answer.selected.length > 0) {
      return `question "${question.id}" takes a choice or a text answer, not both`
    }
  }
  return undefined
}

export function interactionAnswerProblem(
  interaction: BotInteraction,
  answer: BotInteractionAnswer,
): string | undefined {
  switch (interaction.kind) {
    case "question": {
      if (answer.kind !== "question") return "This needs an answer to its questions."
      const byId = new Map(answer.answers.map((item) => [item.id, item]))
      if (byId.size !== answer.answers.length || byId.size !== interaction.questions.length) {
        return "Answer every question once."
      }
      for (const question of interaction.questions) {
        const item = byId.get(question.id)
        if (item === undefined) return `Question "${question.id}" has no answer.`
        const problem = questionProblem(question, item)
        if (problem !== undefined) return `This answer does not fit: ${problem}.`
      }
      return undefined
    }
    case "approval":
      if (answer.kind !== "approval") return "This needs an approval decision."
      return interaction.actions.includes(answer.action)
        ? undefined
        : `This approval does not offer "${answer.action}".`
    case "plan-review":
      if (answer.kind !== "plan-review") return "This needs a plan decision."
      if (answer.feedback !== undefined && !hasText(answer.feedback))
        return "The feedback is empty."
      return answer.approved && answer.feedback !== undefined
        ? "An approval takes no feedback."
        : undefined
  }
}

export function isSkipped(answer: BotQuestionAnswer): boolean {
  return answer.selected.length === 0 && answer.custom === undefined
}
