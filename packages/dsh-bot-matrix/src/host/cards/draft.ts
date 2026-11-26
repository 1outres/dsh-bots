import type { BotQuestion, BotQuestionAnswer } from "@1outres/dsh-bot-core"

export interface DraftItem {
  readonly selected: readonly string[]
  readonly custom?: string
  readonly skipped: boolean
}

export interface QuestionDraft {
  readonly page: number
  readonly items: readonly DraftItem[]
  readonly notice?: DraftNotice
}

export type DraftNotice = { readonly kind: "incomplete"; readonly question: number }

const EMPTY: DraftItem = { selected: [], skipped: false }

export function newDraft(questions: readonly BotQuestion[]): QuestionDraft {
  return { page: 0, items: questions.map(() => EMPTY) }
}

export const isAnswered = (item: DraftItem | undefined): boolean =>
  item !== undefined && (item.skipped || item.selected.length > 0 || item.custom !== undefined)

function replace(draft: QuestionDraft, question: number, item: DraftItem): QuestionDraft {
  const items = draft.items.map((current, at) => (at === question ? item : current))
  return { page: draft.page, items }
}

function nextPage(items: readonly DraftItem[], from: number): number {
  for (let at = from + 1; at < items.length; at += 1) if (!isAnswered(items[at])) return at
  return from
}

export function goTo(
  questions: readonly BotQuestion[],
  draft: QuestionDraft,
  page: number,
): QuestionDraft {
  return { items: draft.items, page: Math.max(0, Math.min(questions.length - 1, page)) }
}

export function choose(
  questions: readonly BotQuestion[],
  draft: QuestionDraft,
  question: number,
  label: string,
): QuestionDraft {
  const target = questions[question]
  const item = draft.items[question]
  if (target === undefined || item === undefined) return draft
  if (!target.multiSelect) {
    const next = replace(draft, question, { selected: [label], skipped: false })
    return { ...next, page: nextPage(next.items, question) }
  }
  const on = !item.selected.includes(label)
  return replace(draft, question, {
    ...item,
    skipped: false,
    selected: target.options
      .map((option) => option.label)
      .filter((value) => (value === label ? on : item.selected.includes(value))),
  })
}

export function selectIn(
  questions: readonly BotQuestion[],
  draft: QuestionDraft,
  question: number,
  labels: readonly string[],
  chosen: readonly string[],
): QuestionDraft {
  const target = questions[question]
  const item = draft.items[question]
  if (target === undefined || item === undefined) return draft
  if (!target.multiSelect) {
    const [label] = chosen
    return label === undefined ? draft : choose(questions, draft, question, label)
  }
  const kept = new Set([...item.selected.filter((label) => !labels.includes(label)), ...chosen])
  return replace(draft, question, {
    ...item,
    skipped: false,
    selected: target.options.map((option) => option.label).filter((label) => kept.has(label)),
  })
}

export function write(
  questions: readonly BotQuestion[],
  draft: QuestionDraft,
  question: number,
  text: string,
): QuestionDraft {
  const target = questions[question]
  const item = draft.items[question]
  if (target === undefined || item === undefined) return draft
  const custom = text.trim()
  if (custom === "") {
    const { custom: _removed, ...rest } = item
    return replace(draft, question, rest)
  }
  const next = replace(draft, question, {
    selected: target.multiSelect ? item.selected : [],
    custom,
    skipped: false,
  })
  return target.multiSelect ? next : { ...next, page: nextPage(next.items, question) }
}

export function skip(
  questions: readonly BotQuestion[],
  draft: QuestionDraft,
  question: number,
): QuestionDraft {
  if (questions[question] === undefined) return draft
  const next = replace(draft, question, { selected: [], skipped: true })
  return { ...next, page: nextPage(next.items, question) }
}

export function withNotice(draft: QuestionDraft, notice: DraftNotice | undefined): QuestionDraft {
  const { notice: _old, ...rest } = draft
  return notice === undefined ? rest : { ...rest, notice }
}

export function answersOf(
  questions: readonly BotQuestion[],
  draft: QuestionDraft,
): { readonly answers: readonly BotQuestionAnswer[] } | { readonly missing: number } {
  const answers: BotQuestionAnswer[] = []
  for (const [at, question] of questions.entries()) {
    const item = draft.items[at]
    if (item === undefined || !isAnswered(item)) return { missing: at }
    answers.push({
      id: question.id,
      selected: item.skipped ? [] : item.selected,
      ...(item.skipped || item.custom === undefined ? {} : { custom: item.custom }),
    })
  }
  return { answers }
}
