import type { BotModelChoice } from "../../shared/models"

/** A list item's identity (a list holds a choice once). */
export const itemKey = (choice: BotModelChoice): string =>
  choice.kind === "profile-default"
    ? choice.kind
    : JSON.stringify([choice.provider, choice.model, choice.reasoningEffort ?? null])

/** `list` with `choice` at its end. */
export const appended = (
  list: readonly BotModelChoice[],
  choice: BotModelChoice,
): readonly BotModelChoice[] => [...list, choice]

/** `list` without its item at `index`. */
export const removed = (
  list: readonly BotModelChoice[],
  index: number,
): readonly BotModelChoice[] => list.filter((_, at) => at !== index)

/** `list` with its item at `index` replaced by `choice`. */
export const replaced = (
  list: readonly BotModelChoice[],
  index: number,
  choice: BotModelChoice,
): readonly BotModelChoice[] => list.map((item, at) => (at === index ? choice : item))

/** `list` with its item at `index` swapped with its neighbour `step` away; undefined at an end. */
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
