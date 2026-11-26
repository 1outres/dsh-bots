import type { BotCreateInput } from "../../shared/bots"
import { ModelsError, refusalOf } from "../models/feed"
import type { RemoteResult } from "../types"

export type BotCreationRequest = Omit<BotCreateInput, "language">

export const creationInput = (request: BotCreationRequest, language: string): BotCreateInput => ({
  ...request,
  language,
})

export function createdBotId(result: RemoteResult<{ readonly id: string }>): string {
  if (result.ok) return result.value.id
  const refusal = refusalOf(result.error)
  throw refusal.kind === "refused" ? new ModelsError(refusal) : new Error(refusal.message)
}
