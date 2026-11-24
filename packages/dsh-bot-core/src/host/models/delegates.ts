import { type BotModelChoice, sameModelChoice } from "../../shared/models"

/** The id a model choice goes by in the session tools: `profile-default`, `<provider>/<model>` or `<provider>/<model>@<effort>`. */
export function modelIdOf(choice: BotModelChoice): string {
  if (choice.kind === "profile-default") return "profile-default"
  const route = `${choice.provider}/${choice.model}`
  return choice.reasoningEffort === undefined ? route : `${route}@${choice.reasoningEffort}`
}

/** The delegate model an id names, if the bot's delegates hold it. */
export function delegateNamed(
  delegates: readonly BotModelChoice[],
  id: string,
): BotModelChoice | undefined {
  return delegates.find((choice) => modelIdOf(choice) === id)
}

/** Whether the bot's delegates hold the choice. */
export function isDelegate(delegates: readonly BotModelChoice[], choice: BotModelChoice): boolean {
  return delegates.some((delegate) => sameModelChoice(delegate, choice))
}
