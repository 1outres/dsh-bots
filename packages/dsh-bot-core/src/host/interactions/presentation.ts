import type { BotChannelText } from "../../shared/channels"
import type {
  BotApprovalAction,
  BotInteraction,
  BotInteractionAnswer,
  BotQuestion,
  BotQuestionWait,
} from "../../shared/interactions"
import type {
  DshAnswerItem,
  DshApprovalOutcome,
  DshApprovalRequest,
  DshLocalized,
  DshQuestionAnswer,
  DshQuestionItem,
} from "./dsh"

export type QuestionPresentation =
  | {
      readonly kind: "plan-review"
      readonly questionId: string
      readonly question: string
      readonly plan: string
      readonly approve: string
    }
  | {
      readonly kind: "approval"
      readonly questionId: string
      readonly subject?: string
      readonly question: BotChannelText
      readonly detail?: BotChannelText
      readonly allowLabel: BotChannelText
      readonly labels: { readonly [Action in BotApprovalAction]?: string }
    }
  | { readonly kind: "question"; readonly questions: readonly BotQuestion[] }

export function textOf(text: DshLocalized): BotChannelText {
  const ja = text.ja
  return ja === undefined ? { en: text.en } : { en: text.en, ja }
}

export function botQuestionOf(item: DshQuestionItem): BotQuestion {
  return {
    id: item.id,
    question: item.question,
    ...(item.header === undefined ? {} : { header: item.header }),
    ...(item.detail === undefined ? {} : { detail: item.detail }),
    options: (item.options ?? []).map((option) => ({
      label: option.label,
      ...(option.description === undefined ? {} : { description: option.description }),
    })),
    multiSelect: item.multiSelect === true,
  }
}

export function presentQuestions(
  items: readonly DshQuestionItem[],
  timed: boolean,
): QuestionPresentation {
  const [item] = items
  const intent = item?.intent
  if (item !== undefined && items.length === 1 && intent !== undefined) {
    const options = item.options ?? []
    if (
      intent.kind === "plan-review" &&
      !timed &&
      item.detail !== undefined &&
      item.multiSelect !== true &&
      options.length <= 2 &&
      options.some((option) => option.label === intent.approve)
    ) {
      return {
        kind: "plan-review",
        questionId: item.id,
        question: item.question,
        plan: item.detail,
        approve: intent.approve,
      }
    }
    if (intent.kind === "approval") {
      const detail =
        intent.display?.detail ?? (item.detail === undefined ? undefined : { en: item.detail })
      const subject = intent.subject?.name ?? item.header
      return {
        kind: "approval",
        questionId: item.id,
        ...(subject === undefined ? {} : { subject }),
        question:
          intent.display === undefined ? { en: item.question } : textOf(intent.display.question),
        ...(detail === undefined ? {} : { detail: textOf(detail) }),
        allowLabel:
          intent.display?.approve === undefined
            ? { en: intent.approve }
            : textOf(intent.display.approve),
        labels: {
          "allow-once": intent.approve,
          reject: intent.reject,
          ...(intent.always === undefined ? {} : { always: intent.always }),
        },
      }
    }
  }
  return { kind: "question", questions: items.map(botQuestionOf) }
}

const APPROVAL_ORDER: readonly BotApprovalAction[] = ["allow-once", "reject", "always"]

export function interactionOfQuestions(
  id: string,
  presentation: QuestionPresentation,
  wait: BotQuestionWait | undefined,
): BotInteraction {
  switch (presentation.kind) {
    case "plan-review":
      return { id, kind: "plan-review", question: presentation.question, plan: presentation.plan }
    case "approval":
      return {
        id,
        kind: "approval",
        ...(presentation.subject === undefined ? {} : { subject: presentation.subject }),
        question: presentation.question,
        ...(presentation.detail === undefined ? {} : { detail: presentation.detail }),
        actions: APPROVAL_ORDER.filter((action) => presentation.labels[action] !== undefined),
        allowLabel: presentation.allowLabel,
        delegated: false,
      }
    case "question":
      return {
        id,
        kind: "question",
        questions: presentation.questions,
        ...(wait === undefined ? {} : { wait }),
      }
  }
}

export type QuestionReply =
  | { readonly kind: "answer"; readonly answer: DshQuestionAnswer }
  | { readonly kind: "cancel" }

const single = (id: string, label: string): DshQuestionAnswer => ({
  answers: [{ id, selected: [label] }],
})

export function replyOf(
  presentation: QuestionPresentation,
  answer: BotInteractionAnswer,
): QuestionReply {
  switch (presentation.kind) {
    case "plan-review": {
      if (answer.kind !== "plan-review") throw new Error("a plan review takes a plan decision")
      const id = presentation.questionId
      if (answer.approved) return { kind: "answer", answer: single(id, presentation.approve) }
      return answer.feedback === undefined
        ? { kind: "cancel" }
        : { kind: "answer", answer: { answers: [{ id, selected: [], custom: answer.feedback }] } }
    }
    case "approval": {
      if (answer.kind !== "approval") throw new Error("an approval takes an approval decision")
      const label = presentation.labels[answer.action]
      if (label === undefined) throw new Error(`this approval does not offer "${answer.action}"`)
      return { kind: "answer", answer: single(presentation.questionId, label) }
    }
    case "question": {
      if (answer.kind !== "question") throw new Error("a question batch takes answers")
      const byId = new Map(answer.answers.map((item) => [item.id, item]))
      return {
        kind: "answer",
        answer: {
          answers: presentation.questions.map((question): DshAnswerItem => {
            const item = byId.get(question.id)
            if (item === undefined) throw new Error(`question "${question.id}" has no answer`)
            return {
              id: question.id,
              selected: [...item.selected],
              ...(item.custom === undefined ? {} : { custom: item.custom }),
            }
          }),
        },
      }
    }
  }
}

const escalation = (toolName: string): BotChannelText => ({
  en: `Tool ${toolName} requests privileged execution`,
  ja: `ツール ${toolName} が特権実行を要求しています`,
})

export function interactionOfApproval(
  id: string,
  request: Pick<DshApprovalRequest<unknown>, "toolName" | "reason" | "displayReason">,
  delegated: boolean,
): BotInteraction {
  const question =
    request.displayReason !== undefined
      ? textOf(request.displayReason)
      : request.reason !== undefined
        ? { en: request.reason }
        : escalation(request.toolName)
  return {
    id,
    kind: "approval",
    subject: request.toolName,
    question,
    actions: ["allow-once", "reject"],
    delegated,
  }
}

export function approvalOutcomeOf(answer: BotInteractionAnswer): DshApprovalOutcome {
  if (answer.kind !== "approval") throw new Error("an approval takes an approval decision")
  switch (answer.action) {
    case "allow-once":
      return "allowed-once"
    case "reject":
      return "rejected"
    case "always":
      throw new Error("a tool approval keeps no grant")
  }
}
