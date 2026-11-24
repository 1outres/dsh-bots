import type {
  BotAnswerOrigin,
  BotApprovalAction,
  BotApprovalInteraction,
  BotInteraction,
  BotInteractionAnswer,
  BotInteractionResolution,
  BotPlanReviewInteraction,
  BotQuestionInteraction,
} from "@1outres/dsh-bot-core"
import {
  type DiscordButton,
  type DiscordButtonStyle,
  type DiscordComponentRow,
  type DiscordEmbed,
  type DiscordMessageEdit,
  MESSAGE_ROW_LIMIT,
  ROW_BUTTON_LIMIT,
  SELECT_OPTION_LIMIT,
} from "../discord"
import { formatForDiscord } from "../format"
import { MESSAGE_LIMIT, splitMessage } from "../split"
import type { DiscordLocale } from "../texts"
import { encodeCustomId, type InteractionAction } from "./custom-id"
import { isAnswered, newDraft, type QuestionDraft } from "./draft"
import { approvalText, countdownText, incompleteText, pickText, text } from "./texts"

const TITLE_LIMIT = 256
const DESCRIPTION_LIMIT = 4096
const BUTTON_LABEL_LIMIT = 80
const OPTION_TEXT_LIMIT = 100
/** A question's detail longer than this goes in messages of its own, before the card. */
export const INLINE_DETAIL_LIMIT = 1500
/** Choices Discord can show: four select menus, the fifth row holds the controls. */
export const MAX_CHOICES = (MESSAGE_ROW_LIMIT - 1) * SELECT_OPTION_LIMIT

export function clip(value: string, limit: number): string {
  const chars = [...value]
  return chars.length <= limit ? value : `${chars.slice(0, limit - 1).join("")}…`
}

/** What a closure or a refused submission adds to the card's first line. */
export type CardState =
  | { readonly kind: "open"; readonly refusal?: string }
  | { readonly kind: "sending" }
  | {
      readonly kind: "closed"
      readonly resolution: BotInteractionResolution
      readonly self: string
    }

const button = (
  interactionId: string,
  action: InteractionAction,
  label: string,
  style: DiscordButtonStyle,
  disabled: boolean,
): DiscordButton => ({
  kind: "button",
  customId: encodeCustomId(interactionId, action),
  label: clip(label, BUTTON_LABEL_LIMIT),
  style,
  disabled,
})

/** Texts posted once before the card: a plan, and question details too long for it. */
export function leadingMessages(
  interaction: BotInteraction,
  locale: DiscordLocale,
): readonly string[] {
  switch (interaction.kind) {
    case "plan-review":
      return splitMessage(
        formatForDiscord(`**${text("planReview", locale)}**\n\n${interaction.plan}`),
      )
    case "question":
      return interaction.questions.flatMap((question, index) =>
        question.detail !== undefined && question.detail.length > INLINE_DETAIL_LIMIT
          ? splitMessage(
              formatForDiscord(
                `**${interaction.questions.length > 1 ? `${index + 1}. ` : ""}${question.header ?? question.question}**\n\n${question.detail}`,
              ),
            )
          : [],
      )
    case "approval":
      return []
  }
}

function waitLine(interaction: BotQuestionInteraction, locale: DiscordLocale): string | undefined {
  switch (interaction.wait?.state) {
    case undefined:
      return undefined
    case "counting":
      return countdownText(interaction.wait.deadline, locale)
    case "held":
      return text("waitHeld", locale)
    case "continued":
      return text("waitContinued", locale)
  }
}

function questionEmbed(
  interaction: BotQuestionInteraction,
  draft: QuestionDraft,
  locale: DiscordLocale,
): DiscordEmbed {
  const page = draft.page
  const question = interaction.questions[page]
  if (question === undefined) return {}
  const total = interaction.questions.length
  const title = `❓ ${question.header ?? text("question", locale)}${total > 1 ? ` (${page + 1}/${total})` : ""}`
  const lines = [`**${question.question}**`]
  if (question.detail !== undefined) {
    lines.push(
      question.detail.length > INLINE_DETAIL_LIMIT ? text("detailAbove", locale) : question.detail,
    )
  }
  if (question.options.length > 0) {
    lines.push(
      question.options
        .map(
          (option, at) =>
            `${at + 1}. **${option.label}**${option.description === undefined ? "" : ` — ${option.description}`}`,
        )
        .join("\n"),
    )
  }
  if (question.options.length > MAX_CHOICES) lines.push(text("tooManyChoices", locale))
  const item = draft.items[page]
  const parts =
    item === undefined
      ? []
      : [...item.selected, ...(item.custom === undefined ? [] : [item.custom])]
  const answer =
    item?.skipped === true
      ? text("skipped", locale)
      : parts.length === 0
        ? text("notAnswered", locale)
        : parts.join(", ")
  const tail = `\n\n**${text("yourAnswer", locale)}:** ${clip(answer, 500)}`
  return {
    title: clip(title, TITLE_LIMIT),
    description: clip(lines.join("\n\n"), DESCRIPTION_LIMIT - tail.length) + tail,
  }
}

function questionRows(
  interaction: BotQuestionInteraction,
  draft: QuestionDraft,
  locale: DiscordLocale,
  disabled: boolean,
): DiscordComponentRow[] {
  const { id } = interaction
  const page = draft.page
  const question = interaction.questions[page]
  const item = draft.items[page]
  if (question === undefined || item === undefined) return []
  const rows: DiscordComponentRow[] = []
  const options = question.options.slice(0, MAX_CHOICES)
  if (options.length > 0 && !question.multiSelect && options.length <= ROW_BUTTON_LIMIT) {
    rows.push(
      options.map((option, at) =>
        button(
          id,
          { kind: "choose", question: page, option: at },
          option.label,
          item.selected.includes(option.label) ? "primary" : "secondary",
          disabled,
        ),
      ),
    )
  } else {
    for (let chunk = 0; chunk * SELECT_OPTION_LIMIT < options.length; chunk += 1) {
      const slice = options.slice(chunk * SELECT_OPTION_LIMIT, (chunk + 1) * SELECT_OPTION_LIMIT)
      rows.push([
        {
          kind: "select",
          customId: encodeCustomId(id, { kind: "select", question: page, chunk }),
          placeholder: text(chunk === 0 ? "choose" : "chooseMore", locale),
          minValues: question.multiSelect ? 0 : 1,
          maxValues: question.multiSelect ? slice.length : 1,
          disabled,
          options: slice.map((option, at) => ({
            value: String(chunk * SELECT_OPTION_LIMIT + at),
            label: clip(option.label, OPTION_TEXT_LIMIT),
            ...(option.description === undefined
              ? {}
              : { description: clip(option.description, OPTION_TEXT_LIMIT) }),
            selected: item.selected.includes(option.label),
          })),
        },
      ])
    }
  }
  const last = page === interaction.questions.length - 1
  const controls: DiscordButton[] = [
    button(
      id,
      { kind: "write", question: page },
      text(question.options.length === 0 ? "answer" : "other", locale),
      item.custom === undefined ? "secondary" : "primary",
      disabled,
    ),
    button(id, { kind: "skip", question: page }, text("skip", locale), "secondary", disabled),
  ]
  if (page > 0) {
    controls.push(
      button(id, { kind: "page", page: page - 1 }, text("back", locale), "secondary", disabled),
    )
  }
  controls.push(
    last
      ? button(id, { kind: "submit" }, text("submit", locale), "success", disabled)
      : button(
          id,
          { kind: "page", page: page + 1 },
          text("next", locale),
          isAnswered(item) ? "primary" : "secondary",
          disabled,
        ),
  )
  if (interaction.wait?.state === "counting") {
    controls.push(button(id, { kind: "hold" }, text("takeTime", locale), "secondary", disabled))
  }
  rows.push(controls)
  return rows
}

const APPROVAL_ORDER: readonly BotApprovalAction[] = ["reject", "allow-once", "always"]
const APPROVAL_STYLES: Readonly<Record<BotApprovalAction, DiscordButtonStyle>> = {
  reject: "danger",
  "allow-once": "success",
  always: "primary",
}

function approvalCard(
  interaction: BotApprovalInteraction,
  locale: DiscordLocale,
  disabled: boolean,
) {
  const lines = [
    ...(interaction.delegated ? [`*${text("delegated", locale)}*`] : []),
    `**${pickText(interaction.question, locale)}**`,
    ...(interaction.detail === undefined ? [] : [pickText(interaction.detail, locale)]),
  ]
  const embed: DiscordEmbed = {
    title: clip(
      `🔐 ${text("approval", locale)}${interaction.subject === undefined ? "" : `: ${interaction.subject}`}`,
      TITLE_LIMIT,
    ),
    description: clip(lines.join("\n\n"), DESCRIPTION_LIMIT),
  }
  const row = APPROVAL_ORDER.filter((action) => interaction.actions.includes(action)).map(
    (action) =>
      button(
        interaction.id,
        { kind: "approval", action },
        action === "allow-once" && interaction.allowLabel !== undefined
          ? pickText(interaction.allowLabel, locale)
          : approvalText(action, locale),
        APPROVAL_STYLES[action],
        disabled,
      ),
  )
  return { embed, rows: [row] }
}

function planCard(interaction: BotPlanReviewInteraction, locale: DiscordLocale, disabled: boolean) {
  return {
    embed: {
      title: `📋 ${text("planReview", locale)}`,
      description: clip(`**${interaction.question}**`, DESCRIPTION_LIMIT),
    },
    rows: [
      [
        button(
          interaction.id,
          { kind: "approve-plan" },
          text("approve", locale),
          "success",
          disabled,
        ),
        button(
          interaction.id,
          { kind: "decline-plan" },
          text("requestChanges", locale),
          "secondary",
          disabled,
        ),
      ],
    ],
  }
}

/** One line per answered question, or the decision. */
export function answerSummary(
  interaction: BotInteraction,
  answer: BotInteractionAnswer,
  locale: DiscordLocale,
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
          return `• ${question.question}: ${parts.length === 0 ? text("skipped", locale) : parts.join(", ")}`
        })
        .join("\n")
    case "approval":
      return `• ${approvalText(answer.action, locale)}`
    case "plan-review":
      return [
        `• ${text(answer.approved ? "approved" : "changesRequested", locale)}`,
        ...(answer.feedback === undefined ? [] : [`> ${answer.feedback}`]),
      ].join("\n")
  }
}

function answeredBy(by: BotAnswerOrigin, self: string, locale: DiscordLocale): string {
  switch (by.via) {
    case "web":
      return text("answeredWeb", locale)
    case "main":
      return text("answeredMain", locale)
    case "channel":
      return by.channelId === self
        ? text("answeredHere", locale)
        : text("answeredElsewhere", locale, { channel: by.channelId })
  }
}

function stateLine(
  interaction: BotInteraction,
  state: CardState,
  draft: QuestionDraft | undefined,
  locale: DiscordLocale,
): string {
  switch (state.kind) {
    case "sending":
      return text("sending", locale)
    case "closed": {
      const { resolution } = state
      if (resolution.kind === "withdrawn") return text("withdrawn", locale)
      const head = answeredBy(resolution.by, state.self, locale)
      return `${head}\n${answerSummary(interaction, resolution.answer, locale)}`
    }
    case "open": {
      const lines: string[] = []
      if (interaction.kind === "question") {
        const wait = waitLine(interaction, locale)
        if (wait !== undefined) lines.push(wait)
      }
      const notice = draft?.notice
      if (notice?.kind === "incomplete") lines.push(incompleteText(notice.question + 1, locale))
      if (state.refusal !== undefined)
        lines.push(text("refused", locale, { message: state.refusal }))
      return lines.join("\n")
    }
  }
}

/** The card of an interaction for one person: its embed, its components (disabled unless open) and its state line. */
export function renderCard(
  interaction: BotInteraction,
  draft: QuestionDraft | undefined,
  state: CardState,
  locale: DiscordLocale,
): DiscordMessageEdit {
  const disabled = state.kind !== "open"
  const content = clip(stateLine(interaction, state, draft, locale), MESSAGE_LIMIT)
  switch (interaction.kind) {
    case "question": {
      const current = draft ?? newDraft(interaction.questions)
      return {
        content,
        embeds: [questionEmbed(interaction, current, locale)],
        components: questionRows(interaction, current, locale, disabled),
      }
    }
    case "approval": {
      const { embed, rows } = approvalCard(interaction, locale, disabled)
      return { content, embeds: [embed], components: rows }
    }
    case "plan-review": {
      const { embed, rows } = planCard(interaction, locale, disabled)
      return { content, embeds: [embed], components: rows }
    }
  }
}

/** What a message of an interaction the bridge no longer holds becomes when pressed. */
export function staleCard(locale: DiscordLocale): DiscordMessageEdit {
  return { content: text("notOpen", locale), components: [] }
}
