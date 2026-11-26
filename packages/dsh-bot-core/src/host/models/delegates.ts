import { type BotModelChoice, sameModelChoice } from "../../shared/models"

export function modelIdOf(choice: BotModelChoice): string {
  if (choice.kind === "profile-default") return "profile-default"
  const route = `${choice.provider}/${choice.model}`
  return choice.reasoningEffort === undefined ? route : `${route}@${choice.reasoningEffort}`
}

export function delegateNamed(
  delegates: readonly BotModelChoice[],
  id: string,
): BotModelChoice | undefined {
  return delegates.find((choice) => modelIdOf(choice) === id)
}

export function isDelegate(delegates: readonly BotModelChoice[], choice: BotModelChoice): boolean {
  return delegates.some((delegate) => sameModelChoice(delegate, choice))
}
