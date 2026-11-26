import type {
  BotAnswerOrigin,
  BotApprovalAction,
  BotInteraction,
  BotInteractionAnswer,
  BotInteractionResolution,
  BotQuestionInteraction,
} from "@1outres/dsh-bot-core"
import { escapeMarkdown } from "../format/markdown"
import { type MatrixLocale, pickText } from "../texts"
import type { QuestionDraft } from "./draft"
import { APPROVAL_KEYS, DIGITS, HOLD } from "./keys"
import { cardText } from "./texts"

export type CardState =
  | { readonly kind: "open"; readonly refusal?: string }
  | {
      readonly kind: "closed"
      readonly resolution: BotInteractionResolution
      readonly self: string
    }

export interface RenderedCard {
  readonly markdown: string
  readonly seeds: readonly string[]
}

const APPROVAL_ORDER: readonly BotApprovalAction[] = ["allow-once", "always", "reject"]
const APPROVAL_WORD = { "allow-once": "allowOnce", always: "always", reject: "reject" } as const

function waitLine(interaction: BotQuestionInteraction, locale: MatrixLocale): string | undefined {
  switch (interaction.wait?.state) {
    case undefined:
      return undefined
    case "counting":
      return cardText("waitCounting", locale, {
        at: `${new Date(interaction.wait.deadline).toISOString().slice(11, 16)} UTC`,
      })
    case "held":
      return cardText("waitHeld", locale)
    case "continued":
      return cardText("waitContinued", locale)
  }
}

export function singleChoice(interaction: BotQuestionInteraction, page: number): boolean {
  const question = interaction.questions[page]
  return (
    question !== undefined &&
    !question.multiSelect &&
    question.options.length > 0 &&
    question.options.length <= DIGITS.length
  )
}

function answerOfItem(
  item: QuestionDraft["items"][number] | undefined,
  locale: MatrixLocale,
): string | undefined {
  if (item === undefined) return undefined
  if (item.skipped) return cardText("skipped", locale)
  const parts = [...item.selected, ...(item.custom === undefined ? [] : [item.custom])]
  return parts.length === 0 ? undefined : parts.join(", ")
}

function questionCard(
  interaction: BotQuestionInteraction,
  draft: QuestionDraft,
  locale: MatrixLocale,
): RenderedCard {
  const page = draft.page
  const question = interaction.questions[page]
  if (question === undefined) return { markdown: "", seeds: [] }
  const total = interaction.questions.length
  const lines = [
    `**❓ ${escapeMarkdown(question.header ?? cardText("question", locale))}${total > 1 ? ` (${page + 1}/${total})` : ""}**`,
    "",
    `**${escapeMarkdown(question.question)}**`,
  ]
  if (question.detail !== undefined) lines.push("", question.detail)
  if (question.options.length > 0) {
    lines.push("")
    for (const [at, option] of question.options.entries()) {
      const mark = at < DIGITS.length ? DIGITS[at] : `${at + 1}.`
      lines.push(
        `${mark} **${escapeMarkdown(option.label)}**${option.description === undefined ? "" : ` — ${escapeMarkdown(option.description)}`}  `,
      )
    }
  }
  const answered = interaction.questions
    .map((item, at) => ({ item, answer: answerOfItem(draft.items[at], locale) }))
    .filter((entry) => entry.answer !== undefined)
  if (answered.length > 0) {
    lines.push("", `*${cardText("answers", locale)}*`)
    for (const entry of answered)
      lines.push(
        `- ${escapeMarkdown(entry.item.question)}: ${escapeMarkdown(entry.answer as string)}`,
      )
  }
  const single = singleChoice(interaction, page)
  lines.push(
    "",
    cardText(question.options.length === 0 ? "howText" : single ? "howSingle" : "howMulti", locale),
  )
  const counting = interaction.wait?.state === "counting"
  if (counting) lines.push(cardText("howHold", locale))
  const wait = waitLine(interaction, locale)
  if (wait !== undefined) lines.push("", wait)
  const seeds = [
    ...(single ? DIGITS.slice(0, question.options.length) : []),
    ...(counting ? [HOLD] : []),
  ]
  return { markdown: lines.join("\n"), seeds }
}

function approvalCard(
  interaction: Extract<BotInteraction, { kind: "approval" }>,
  locale: MatrixLocale,
): RenderedCard {
  const actions = APPROVAL_ORDER.filter((action) => interaction.actions.includes(action))
  const keys = actions
    .map((action) => {
      const word =
        action === "allow-once" && interaction.allowLabel !== undefined
          ? pickText(interaction.allowLabel, locale)
          : cardText(APPROVAL_WORD[action], locale)
      return `${APPROVAL_KEYS[action]} ${word}`
    })
    .join(" · ")
  const lines = [
    `**🔐 ${cardText("approval", locale)}${interaction.subject === undefined ? "" : `: ${escapeMarkdown(interaction.subject)}`}**`,
    ...(interaction.delegated ? ["", `*${cardText("delegated", locale)}*`] : []),
    "",
    `**${escapeMarkdown(pickText(interaction.question, locale))}**`,
    ...(interaction.detail === undefined ? [] : ["", pickText(interaction.detail, locale)]),
    "",
    cardText("howApproval", locale, { keys }),
  ]
  return { markdown: lines.join("\n"), seeds: actions.map((action) => APPROVAL_KEYS[action]) }
}

function planCard(
  interaction: Extract<BotInteraction, { kind: "plan-review" }>,
  locale: MatrixLocale,
): RenderedCard {
  return {
    markdown: [
      `**📋 ${cardText("planReview", locale)}**`,
      "",
      `**${escapeMarkdown(interaction.question)}**`,
      "",
      interaction.plan,
      "",
      cardText("howPlan", locale),
    ].join("\n"),
    seeds: [APPROVAL_KEYS["allow-once"], APPROVAL_KEYS.reject],
  }
}

function answerSummary(
  interaction: BotInteraction,
  answer: BotInteractionAnswer,
  locale: MatrixLocale,
): string {
  switch (answer.kind) {
    case "question":
      if (interaction.kind !== "question") return ""
      return interaction.questions
        .map((question) => {
          const item = answer.answers.find((entry) => entry.id === question.id)
          const parts = [
            ...(item?.selected ?? []),
            ...(item?.custom === undefined ? [] : [item.custom]),
          ]
          return `- ${escapeMarkdown(question.question)}: ${parts.length === 0 ? cardText("skipped", locale) : escapeMarkdown(parts.join(", "))}`
        })
        .join("\n")
    case "approval":
      return `- ${cardText(APPROVAL_WORD[answer.action], locale)}`
    case "plan-review":
      return [
        `- ${cardText(answer.approved ? "approved" : "changesRequested", locale)}`,
        ...(answer.feedback === undefined ? [] : [`> ${answer.feedback}`]),
      ].join("\n")
  }
}

function answeredBy(by: BotAnswerOrigin, self: string, locale: MatrixLocale): string {
  switch (by.via) {
    case "web":
      return cardText("answeredWeb", locale)
    case "main":
      return cardText("answeredMain", locale)
    case "channel":
      return by.channelId === self
        ? cardText("answeredHere", locale)
        : cardText("answeredElsewhere", locale, { channel: by.channelId })
  }
}

function titleOf(interaction: BotInteraction, locale: MatrixLocale): string {
  switch (interaction.kind) {
    case "question":
      return `**❓ ${escapeMarkdown(interaction.questions[0]?.header ?? cardText("question", locale))}**`
    case "approval":
      return `**🔐 ${cardText("approval", locale)}${interaction.subject === undefined ? "" : `: ${escapeMarkdown(interaction.subject)}`}**`
    case "plan-review":
      return `**📋 ${cardText("planReview", locale)}**`
  }
}

export function renderCard(
  interaction: BotInteraction,
  draft: QuestionDraft,
  state: CardState,
  locale: MatrixLocale,
): RenderedCard {
  if (state.kind === "closed") {
    const { resolution } = state
    const result =
      resolution.kind === "withdrawn"
        ? cardText("withdrawn", locale)
        : `${answeredBy(resolution.by, state.self, locale)}\n${answerSummary(interaction, resolution.answer, locale)}`
    return { markdown: `${titleOf(interaction, locale)}\n\n${result}`, seeds: [] }
  }
  const card =
    interaction.kind === "question"
      ? questionCard(interaction, draft, locale)
      : interaction.kind === "approval"
        ? approvalCard(interaction, locale)
        : planCard(interaction, locale)
  return state.refusal === undefined
    ? card
    : {
        ...card,
        markdown: `${card.markdown}\n\n${cardText("refused", locale, { message: state.refusal })}`,
      }
}
