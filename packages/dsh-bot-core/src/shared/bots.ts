import type { BotAvatar } from "./avatar"
import { BOT_CREATION_OPTIONS, type BotCreationOption } from "./connectors"
import type { BotEnvironmentCapacityState, BotEnvironmentNeed } from "./environment"
import type { BotModelCatalog, BotModelsChange, BotModelsView } from "./models"

export interface BotView {
  readonly id: string
  readonly name: string
  readonly avatar: BotAvatar
  readonly mainSessionId: string
  readonly mainStartedAt: number
  readonly sessionIds: readonly string[]
  readonly formerMainIds: readonly string[]
  readonly timezone: string
  readonly language?: string
  readonly createdAt: number
}

export function sessionsOfBot(bot: BotView): readonly string[] {
  return [bot.mainSessionId, ...bot.sessionIds]
}

export const ENVIRONMENT_PHASES = ["queued", "image", "creating", "booting", "connecting"] as const

export type EnvironmentPhase = (typeof ENVIRONMENT_PHASES)[number]

export const CREATION_PHASES = [...ENVIRONMENT_PHASES, "preset", "starting-main"] as const

export type CreationPhase = (typeof CREATION_PHASES)[number]

export interface BotFailure {
  readonly message: string
  readonly at: number
}

export type BotOperation =
  | { readonly kind: "create"; readonly phase: CreationPhase }
  | { readonly kind: "remove" }

export interface PendingBotView {
  readonly id: string
  readonly name: string
  readonly avatar: BotAvatar
  readonly operation: BotOperation
  readonly startedAt: number
  readonly failure?: BotFailure
  readonly sessionIds: readonly string[]
  readonly createdAt: number
}

export interface BotsSnapshot {
  readonly bots: readonly BotView[]
  readonly pending: readonly PendingBotView[]
  readonly preparingSessionIds: readonly string[]
}

export interface BotAccepted {
  readonly accepted: true
}

export type BotCreationChoices = { readonly [Option in BotCreationOption]: boolean }

export interface BotCreateInput extends BotCreationChoices {
  readonly name: string
  readonly avatar: BotAvatar
  readonly language: string
  readonly timezone: string
  readonly models?: BotModelsChange
  readonly channels: readonly string[]
}

export interface BotCreationOptionOffer {
  readonly option: BotCreationOption
  readonly needs: readonly BotEnvironmentNeed[]
}

export interface BotCreationOffer {
  readonly options: readonly BotCreationOptionOffer[]
  readonly capacity: BotEnvironmentCapacityState
}

export interface BotUpdateInput {
  readonly name?: string
  readonly avatar?: BotAvatar
  readonly timezone?: string
  readonly language?: string
}

export interface BotsApi {
  watch(signal?: AbortSignal): AsyncIterable<BotsSnapshot>
  create(input: BotCreateInput): Promise<{ readonly id: string }>
  creationOptions(): Promise<BotCreationOffer>
  retryCreate(id: string): Promise<BotAccepted>
  discardCreate(id: string): Promise<BotAccepted>
  update(id: string, input: BotUpdateInput): Promise<BotView>
  removeBot(id: string): Promise<BotAccepted>
  retryRemove(id: string): Promise<BotAccepted>
  dismissRemove(id: string): Promise<BotAccepted>
  createSession(botId: string): Promise<{ readonly sessionId: string }>
  models(id: string): Promise<BotModelsView>
  watchModels(id: string, signal?: AbortSignal): AsyncIterable<BotModelsView>
  configureModels(id: string, change: BotModelsChange): Promise<BotModelsView>
  modelCatalog(): Promise<BotModelCatalog>
}

export const MAX_NAME_LENGTH = 64
export function validateName(name: unknown): string {
  if (typeof name !== "string") throw new Error("name must be a string")
  const trimmed = name.trim()
  if (trimmed.length === 0) throw new Error("name is empty")
  if (trimmed.length > MAX_NAME_LENGTH) throw new Error(`name is longer than ${MAX_NAME_LENGTH}`)
  return trimmed
}

export function validateCreationChoices(input: unknown): BotCreationChoices {
  if (typeof input !== "object" || input === null) throw new Error("the creation is missing")
  const value = input as Record<string, unknown>
  return Object.fromEntries(
    BOT_CREATION_OPTIONS.map((option) => {
      const chosen = value[option]
      if (typeof chosen !== "boolean") throw new Error(`${option} must be true or false`)
      return [option, chosen]
    }),
  ) as BotCreationChoices
}

const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

export function validateLanguage(language: unknown): string {
  if (typeof language !== "string" || !LANGUAGE_TAG.test(language)) {
    throw new Error("language must be a BCP 47 language tag such as en or ja")
  }
  return language
}
