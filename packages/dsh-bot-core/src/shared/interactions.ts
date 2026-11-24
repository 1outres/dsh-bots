/**
 * What waits for a person's decision in a bot's session (a question batch, an
 * approval, a plan review), the answers it takes and how it settles. Wire
 * shapes shared by the Host, the browser and the channel contract, and the
 * check every answer passes before it reaches DSH.
 */
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
  /** Markdown shown with the question. */
  readonly detail?: string
  readonly options: readonly BotQuestionOption[]
  readonly multiSelect: boolean
}

/**
 * The foreground wait of a timed question batch (DSH's `askTimed`): it counts
 * down to `deadline` (epoch milliseconds, the Host's clock) until a person
 * starts answering (`held`: it then waits for the answer). At the deadline the
 * bot goes on (`continued`); an answer still reaches it, as a message.
 */
export type BotQuestionWait =
  | { readonly state: "counting"; readonly deadline: number }
  | { readonly state: "held" }
  | { readonly state: "continued" }

/** The actions an approval offers; `always` only when the asker can keep such a grant. */
export type BotApprovalAction = "allow-once" | "reject" | "always"

export interface BotQuestionInteraction {
  readonly id: string
  readonly kind: "question"
  readonly questions: readonly BotQuestion[]
  /** Absent: the batch waits until it is answered. */
  readonly wait?: BotQuestionWait
}

export interface BotApprovalInteraction {
  readonly id: string
  readonly kind: "approval"
  /** What the decision is about: a tool's name, or the subject the asker names. */
  readonly subject?: string
  readonly question: BotChannelText
  readonly detail?: BotChannelText
  readonly actions: readonly BotApprovalAction[]
  /** The asker's wording of `allow-once` (e.g. "Allow for this session"); absent: allow once. */
  readonly allowLabel?: BotChannelText
  /** A subagent of the session asks. */
  readonly delegated: boolean
}

export interface BotPlanReviewInteraction {
  readonly id: string
  readonly kind: "plan-review"
  readonly question: string
  /** The plan, Markdown. */
  readonly plan: string
}

export type BotInteraction =
  | BotQuestionInteraction
  | BotApprovalInteraction
  | BotPlanReviewInteraction

/**
 * One question's answer, as DSH's `ask_user_question` takes it: the chosen
 * labels and free text. A single-select question takes one label or the text
 * (never both); a multi-select one any labels and optional text. No label and
 * no text skips the question.
 */
export interface BotQuestionAnswer {
  readonly id: string
  readonly selected: readonly string[]
  readonly custom?: string
}

export type BotInteractionAnswer =
  | { readonly kind: "question"; readonly answers: readonly BotQuestionAnswer[] }
  | { readonly kind: "approval"; readonly action: BotApprovalAction }
  | { readonly kind: "plan-review"; readonly approved: boolean; readonly feedback?: string }

/** Who settled an interaction: DSH's Web UI, a channel, or the Main session managing the session. */
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
  /** Its turn ended or was stopped, or it was answered outside bot-core. */
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

/** An open interaction as the browser gets it; `remainingMs` while its wait counts down. */
export interface BotOpenInteraction {
  readonly interaction: BotInteraction
  readonly remainingMs?: number
}

export interface BotClosedInteraction {
  readonly interaction: BotInteraction
  readonly resolution: BotInteractionResolution
}

/** What the `botInteractions` Remote's `watch` streams for one bot session. */
export interface BotInteractionsSnapshot {
  readonly sessionId: string
  /** In opening order. */
  readonly open: readonly BotOpenInteraction[]
  /** The latest closures, oldest first. */
  readonly closed: readonly BotClosedInteraction[]
  /** The names of the channels the closures name, by id. */
  readonly channelNames: Readonly<Record<string, string>>
}

/** The `botInteractions` Remote: a bot session's interactions, answered from the browser. */
export interface BotInteractionsApi {
  /** The session's interactions, again after every change. */
  watch(sessionId: string, signal?: AbortSignal): AsyncIterable<BotInteractionsSnapshot>
  /** Answer one; the first answer from anywhere wins. */
  answer(
    sessionId: string,
    interactionId: string,
    answer: BotInteractionAnswer,
  ): Promise<BotAnswerResult>
  /** A person started answering a timed question batch: keep waiting for them. */
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

/** Why an answer does not fit its interaction, or undefined when it does. */
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

/** Whether a question's answer skips it (no choice, no text). */
export function isSkipped(answer: BotQuestionAnswer): boolean {
  return answer.selected.length === 0 && answer.custom === undefined
}
