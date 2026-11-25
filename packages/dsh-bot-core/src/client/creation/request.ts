import type { BotCreateInput } from "../../shared/bots"
import { ModelsError, refusalOf } from "../models/feed"
import type { RemoteResult } from "../types"

/** What the New bot form gives: everything but the language, which the browser adds. */
export type BotCreationRequest = Omit<BotCreateInput, "language">

/** The input a creation sends: the form's, in the language bot-core is shown in (its `format.locale`). */
export const creationInput = (request: BotCreationRequest, language: string): BotCreateInput => ({
  ...request,
  language,
})

/**
 * The new bot's id; a refused model rejects with a {@link ModelsError}, any
 * other refusal with the Host's message.
 */
export function createdBotId(result: RemoteResult<{ readonly id: string }>): string {
  if (result.ok) return result.value.id
  const refusal = refusalOf(result.error)
  throw refusal.kind === "refused" ? new ModelsError(refusal) : new Error(refusal.message)
}
