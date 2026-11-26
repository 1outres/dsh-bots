import type { BotQuestion, BotQuestionAnswer } from "../../shared/interactions"

export interface QuestionDraftItem {
  readonly selected: readonly string[]
  readonly custom: string
  readonly skipped: boolean
}

export interface QuestionDraft {
  readonly page: number
  readonly items: readonly QuestionDraftItem[]
}

export type QuestionDraftAction =
  | { readonly kind: "choose"; readonly question: number; readonly label: string }
  | { readonly kind: "write"; readonly question: number; readonly text: string }
  | { readonly kind: "skip"; readonly question: number }
  | { readonly kind: "page"; readonly page: number }

const EMPTY: QuestionDraftItem = { selected: [], custom: "", skipped: false }

export function initialDraft(questions: readonly BotQuestion[]): QuestionDraft {
  return { page: 0, items: questions.map(() => EMPTY) }
}

const answered = (item: QuestionDraftItem): boolean =>
  item.skipped || item.selected.length > 0 || item.custom.trim().length > 0

function chosen(question: BotQuestion, item: QuestionDraftItem, label: string): QuestionDraftItem {
  if (!question.multiSelect) return { selected: [label], custom: "", skipped: false }
  const selected = item.selected.includes(label)
    ? item.selected.filter((value) => value !== label)
    : question.options
        .map((option) => option.label)
        .filter((value) => value === label || item.selected.includes(value))
  return { ...item, selected, skipped: false }
}

function written(question: BotQuestion, item: QuestionDraftItem, text: string): QuestionDraftItem {
  const clears = !question.multiSelect && text.trim().length > 0
  return { selected: clears ? [] : item.selected, custom: text, skipped: false }
}

export function reduceDraft(
  questions: readonly BotQuestion[],
  draft: QuestionDraft,
  action: QuestionDraftAction,
): QuestionDraft {
  const replace = (index: number, item: QuestionDraftItem) =>
    draft.items.map((current, at) => (at === index ? item : current))
  const question = "question" in action ? questions[action.question] : undefined
  const item = "question" in action ? draft.items[action.question] : undefined
  switch (action.kind) {
    case "page":
      return { ...draft, page: Math.max(0, Math.min(questions.length - 1, action.page)) }
    case "choose": {
      if (question === undefined || item === undefined) return draft
      const items = replace(action.question, chosen(question, item, action.label))
      const page = question.multiSelect ? draft.page : nextPage(items, action.question)
      return { page, items }
    }
    case "write":
      if (question === undefined || item === undefined) return draft
      return { ...draft, items: replace(action.question, written(question, item, action.text)) }
    case "skip": {
      if (item === undefined) return draft
      const items = replace(action.question, { selected: [], custom: "", skipped: true })
      return { page: nextPage(items, action.question), items }
    }
  }
}

function nextPage(items: readonly QuestionDraftItem[], from: number): number {
  for (let index = from + 1; index < items.length; index += 1) {
    if (!answered(items[index] ?? EMPTY)) return index
  }
  return from
}

export type DraftSubmission =
  | { readonly kind: "ready"; readonly answers: readonly BotQuestionAnswer[] }
  | { readonly kind: "incomplete"; readonly page: number }

export function submissionOf(
  questions: readonly BotQuestion[],
  draft: QuestionDraft,
): DraftSubmission {
  const answers: BotQuestionAnswer[] = []
  for (const [index, question] of questions.entries()) {
    const item = draft.items[index] ?? EMPTY
    if (!answered(item)) return { kind: "incomplete", page: index }
    const custom = item.custom.trim()
    answers.push({
      id: question.id,
      selected: item.skipped ? [] : item.selected,
      ...(item.skipped || custom.length === 0 ? {} : { custom }),
    })
  }
  return { kind: "ready", answers }
}

export function isAnswered(item: QuestionDraftItem | undefined): boolean {
  return item !== undefined && answered(item)
}
