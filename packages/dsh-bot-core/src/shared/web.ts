export type BotWebCapability = "search" | "fetch"

export const BOT_WEB_CAPABILITIES: readonly BotWebCapability[] = ["search", "fetch"]

export interface BotWebText {
  readonly en: string
  readonly ja?: string
}

export type BotWebTestResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly reason:
        | "invalid-secret"
        | "no-credits"
        | "rate-limited"
        | "unreachable"
        | "unexpected"
      readonly message: string
    }

export interface BotWebSettings {
  readonly backend: string
  readonly search: boolean
  readonly fetch: boolean
}

export const DEFAULT_WEB_BACKEND = "exa"

export const DEFAULT_WEB_SETTINGS: BotWebSettings = {
  backend: DEFAULT_WEB_BACKEND,
  search: true,
  fetch: true,
}

export type BotWebUnavailableReason = "not-registered" | "no-capability" | "no-credentials-service"

export type BotWebCapabilityStatus =
  | { readonly state: "ready"; readonly backend: string }
  | { readonly state: "disabled" }
  | {
      readonly state: "missing-secrets"
      readonly backend: string
      readonly keys: readonly string[]
    }
  | {
      readonly state: "unavailable"
      readonly backend: string
      readonly reason: BotWebUnavailableReason
    }

export interface BotWebStatus {
  readonly search: BotWebCapabilityStatus
  readonly fetch: BotWebCapabilityStatus
}

export interface BotWebSecretView {
  readonly key: string
  readonly label: BotWebText
  readonly set: boolean
}

export interface BotWebBackendView {
  readonly id: string
  readonly name: BotWebText
  readonly description?: BotWebText
  readonly capabilities: readonly BotWebCapability[]
  readonly secrets: readonly BotWebSecretView[]
}

export interface BotWebView {
  readonly backend: BotWebBackendView | null
  readonly settings: BotWebSettings
  readonly status: BotWebStatus
}

export type BotWebSecretChange =
  | { readonly op: "set"; readonly value: string }
  | { readonly op: "clear" }

export const BOT_WEB_ERROR_CODES = [
  "bot-web/unknown-secret",
  "bot-web/missing-secrets",
  "bot-web/not-registered",
  "bot-web/no-capability",
  "bot-web/busy",
  "bot-web/unavailable",
] as const

export type BotWebErrorCode = (typeof BOT_WEB_ERROR_CODES)[number]

export type BotWebErrorDetails = { readonly [Code in BotWebErrorCode]: Record<string, never> }

export interface BotWebApi {
  view(): Promise<BotWebView>
  watch(signal?: AbortSignal): AsyncIterable<BotWebView>
  setEnabled(capability: BotWebCapability, enabled: boolean): Promise<BotWebView>
  setSecret(key: string, change: BotWebSecretChange): Promise<BotWebView>
  test(): Promise<BotWebTestResult>
}

const BACKEND_ID = /^[a-z][a-z0-9-]*$/
const SECRET_KEY = /^[a-z][a-zA-Z0-9]*$/

export const MAX_WEB_SECRET_LENGTH = 4096

export function isWebBackendId(id: unknown): id is string {
  return typeof id === "string" && BACKEND_ID.test(id)
}

export function isWebSecretKey(key: unknown): key is string {
  return typeof key === "string" && SECRET_KEY.test(key)
}

export function isWebCapability(value: unknown): value is BotWebCapability {
  return value === "search" || value === "fetch"
}

export function webNeedsAttention(status: BotWebStatus): boolean {
  return BOT_WEB_CAPABILITIES.some((capability) => {
    const state = status[capability].state
    return state !== "ready" && state !== "disabled"
  })
}

export const WEB_PROVIDER_ID = "bot-core"
