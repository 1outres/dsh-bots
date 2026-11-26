export type BotModelRoleArity = "one" | "list"

export const BOT_MODEL_ROLES = {
  main: "one",
  utility: "one",
  delegates: "list",
} as const satisfies Readonly<Record<string, BotModelRoleArity>>

export type BotModelRole = keyof typeof BOT_MODEL_ROLES

export type BotModelSingleRole = {
  [Role in BotModelRole]: (typeof BOT_MODEL_ROLES)[Role] extends "one" ? Role : never
}[BotModelRole]

export type BotModelListRole = Exclude<BotModelRole, BotModelSingleRole>

export const BOT_MODEL_ROLE_IDS = Object.keys(BOT_MODEL_ROLES) as readonly BotModelRole[]

export interface BotModelSelection {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string
}

export type BotModelChoice = { readonly kind: "profile-default" } | BotFixedModelChoice

export type BotFixedModelChoice = { readonly kind: "fixed" } & BotModelSelection

export type BotModelSettings = {
  readonly [Role in BotModelRole]: (typeof BOT_MODEL_ROLES)[Role] extends "list"
    ? readonly BotModelChoice[]
    : BotModelChoice
}

export type BotModelsChange = { readonly [Role in BotModelRole]?: BotModelSettings[Role] }

export const PROFILE_DEFAULT_MODEL: BotModelChoice = Object.freeze({ kind: "profile-default" })

export const DEFAULT_BOT_MODELS: BotModelSettings = Object.freeze({
  main: PROFILE_DEFAULT_MODEL,
  utility: PROFILE_DEFAULT_MODEL,
  delegates: Object.freeze([]),
})

export interface BotModelsView {
  readonly botId: string
  readonly models: BotModelSettings
  readonly mainPending: boolean
}

export interface BotModelEffortOffer {
  readonly id: string
  readonly name: string
  readonly description?: string
}

export interface BotModelOffer {
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly reasoning?: {
    readonly efforts: readonly BotModelEffortOffer[]
    readonly defaultEffort?: string
  }
}

export interface BotModelProviderOffer {
  readonly id: string
  readonly name: string
  readonly models: readonly BotModelOffer[]
}

export interface BotModelProviderFailure {
  readonly id: string
  readonly name: string
  readonly message: string
}

export interface BotModelCatalog {
  readonly profileDefault: BotModelSelection
  readonly providers: readonly BotModelProviderOffer[]
  readonly failures: readonly BotModelProviderFailure[]
}

export const BOT_MODELS_ERROR_CODES = [
  "bot-models/not-found",
  "bot-models/unknown-provider",
  "bot-models/unknown-model",
  "bot-models/invalid-effort",
  "bot-models/catalog-failed",
  "bot-models/rejected",
] as const

export type BotModelsErrorCode = (typeof BOT_MODELS_ERROR_CODES)[number]

export interface BotModelsErrorPlace {
  readonly role?: BotModelRole
  readonly index?: number
}

export type BotModelsErrorDetails = { readonly [Code in BotModelsErrorCode]: BotModelsErrorPlace }

export const MAX_MODEL_ID_LENGTH = 256
export const MAX_DELEGATE_MODELS = 32

function text(value: unknown, at: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_MODEL_ID_LENGTH) {
    throw new Error(`${at} must be a non-empty string of at most ${MAX_MODEL_ID_LENGTH} characters`)
  }
  return value
}

export function parseModelChoice(value: unknown, at: string): BotModelChoice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${at} must be an object`)
  }
  const fields = value as Record<string, unknown>
  if (fields.kind === "profile-default") {
    if (Object.keys(fields).length !== 1) throw new Error(`${at} takes no other field`)
    return PROFILE_DEFAULT_MODEL
  }
  if (fields.kind !== "fixed") throw new Error(`${at}.kind must be "profile-default" or "fixed"`)
  const unknown = Object.keys(fields).filter(
    (key) => !["kind", "provider", "model", "reasoningEffort"].includes(key),
  )
  if (unknown.length > 0) throw new Error(`${at} has unknown fields: ${unknown.join(", ")}`)
  return {
    kind: "fixed",
    provider: text(fields.provider, `${at}.provider`),
    model: text(fields.model, `${at}.model`),
    ...(fields.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: text(fields.reasoningEffort, `${at}.reasoningEffort`) }),
  }
}

export function sameModelChoice(left: BotModelChoice, right: BotModelChoice): boolean {
  if (left.kind === "profile-default" || right.kind === "profile-default") {
    return left.kind === right.kind
  }
  return (
    left.provider === right.provider &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort
  )
}

function parseList(value: unknown, role: BotModelListRole): readonly BotModelChoice[] {
  if (!Array.isArray(value)) throw new Error(`${role} must be a list`)
  if (value.length > MAX_DELEGATE_MODELS) {
    throw new Error(`${role} holds at most ${MAX_DELEGATE_MODELS} models`)
  }
  const choices = value.map((item, index) => parseModelChoice(item, `${role}[${index}]`))
  choices.forEach((choice, index) => {
    if (choices.slice(0, index).some((earlier) => sameModelChoice(earlier, choice))) {
      throw new Error(`${role}[${index}] repeats an earlier choice`)
    }
  })
  return choices
}

export function parseModelsChange(value: unknown): BotModelsChange {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the model change must be an object")
  }
  const fields = value as Record<string, unknown>
  const unknown = Object.keys(fields).filter((key) => !Object.hasOwn(BOT_MODEL_ROLES, key))
  if (unknown.length > 0) throw new Error(`unknown model roles: ${unknown.join(", ")}`)
  const change: { [Role in BotModelRole]?: BotModelSettings[Role] } = {}
  for (const role of BOT_MODEL_ROLE_IDS) {
    const given = fields[role]
    if (given === undefined) continue
    Object.assign(change, {
      [role]:
        BOT_MODEL_ROLES[role] === "list"
          ? parseList(given, role as BotModelListRole)
          : parseModelChoice(given, role),
    })
  }
  return change
}

export function applyModelsChange(
  settings: BotModelSettings,
  change: BotModelsChange,
): BotModelSettings {
  return { ...settings, ...change }
}

export function fixedChoices(
  change: BotModelsChange,
): readonly { readonly place: BotModelsErrorPlace; readonly selection: BotModelSelection }[] {
  return BOT_MODEL_ROLE_IDS.flatMap((role) => {
    const given = change[role]
    if (given === undefined) return []
    const list: readonly BotModelChoice[] = Array.isArray(given) ? given : [given as BotModelChoice]
    return list.flatMap((choice, index) =>
      choice.kind === "fixed"
        ? [
            {
              place: Array.isArray(given) ? { role, index } : { role },
              selection: selectionOf(choice),
            },
          ]
        : [],
    )
  })
}

export function selectionOf(choice: BotFixedModelChoice): BotModelSelection {
  return {
    provider: choice.provider,
    model: choice.model,
    ...(choice.reasoningEffort === undefined ? {} : { reasoningEffort: choice.reasoningEffort }),
  }
}
