import type { BotModelChoice } from "../../shared/models"

export const itemKey = (choice: BotModelChoice): string =>
  choice.kind === "profile-default"
    ? choice.kind
    : JSON.stringify([choice.provider, choice.model, choice.reasoningEffort ?? null])

export const appended = (
  list: readonly BotModelChoice[],
  choice: BotModelChoice,
): readonly BotModelChoice[] => [...list, choice]

export const removed = (
  list: readonly BotModelChoice[],
  index: number,
): readonly BotModelChoice[] => list.filter((_, at) => at !== index)

export const replaced = (
  list: readonly BotModelChoice[],
  index: number,
  choice: BotModelChoice,
): readonly BotModelChoice[] => list.map((item, at) => (at === index ? choice : item))

export function moved(
  list: readonly BotModelChoice[],
  index: number,
  step: -1 | 1,
): readonly BotModelChoice[] | undefined {
  const other = index + step
  const item = list[index]
  const neighbour = list[other]
  if (item === undefined || neighbour === undefined) return undefined
  return list.map((current, at) => (at === index ? neighbour : at === other ? item : current))
}
