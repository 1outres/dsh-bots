import type { BotInteraction, BotInteractionAnswer } from "../../shared/interactions"
import type { Translate } from "../types"

export function answerSummary(
  t: Translate,
  interaction: BotInteraction,
  answer: BotInteractionAnswer,
): readonly string[] {
  switch (answer.kind) {
    case "question": {
      if (interaction.kind !== "question") return []
      return interaction.questions.map((question) => {
        const item = answer.answers.find((entry) => entry.id === question.id)
        const parts = [
          ...(item?.selected ?? []),
          ...(item?.custom === undefined ? [] : [item.custom]),
        ]
        return `${question.question}: ${parts.length === 0 ? t("ask.skipped") : parts.join(", ")}`
      })
    }
    case "approval":
      return [t(`ask.approval.${answer.action}`)]
    case "plan-review":
      return [
        answer.approved ? t("ask.plan.approved") : t("ask.plan.declined"),
        ...(answer.feedback === undefined ? [] : [answer.feedback]),
      ]
  }
}
