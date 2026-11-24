/**
 * Web lookup of every bot (web_search / web_fetch): which capabilities are
 * on, whether the backend can serve them, and the `botWeb` Remote. Wire
 * shapes shared by the Host, the browser and the backend contract.
 */

export type BotWebCapability = "search" | "fetch"

export const BOT_WEB_CAPABILITIES: readonly BotWebCapability[] = ["search", "fetch"]

/** Text a backend shows in the browser; English is required. */
export interface BotWebText {
  readonly en: string
  readonly ja?: string
}

/** What a connection test of a backend's stored secrets found. */
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
      /** A sentence for a person; never carries a secret. */
      readonly message: string
    }

/** Every bot's web lookup settings. Which backend is stored, though nothing chooses it yet. */
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

/** Whether bots can use one capability; only `ready` shows its tool. */
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

/** One secret of the backend: whether it is set, never its value. */
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

/** What the `botWeb` Remote shows: the settings' backend (`null` while it is not registered), the settings and the status. */
export interface BotWebView {
  readonly backend: BotWebBackendView | null
  readonly settings: BotWebSettings
  readonly status: BotWebStatus
}

/** A secret's change: set (or replace) it, or clear it. */
export type BotWebSecretChange =
  | { readonly op: "set"; readonly value: string }
  | { readonly op: "clear" }

/** Every `bot-web/…` refusal of the `botWeb` Remote. */
export const BOT_WEB_ERROR_CODES = [
  "bot-web/unknown-secret",
  "bot-web/missing-secrets",
  "bot-web/not-registered",
  "bot-web/no-capability",
  "bot-web/busy",
  "bot-web/unavailable",
] as const

export type BotWebErrorCode = (typeof BOT_WEB_ERROR_CODES)[number]

/** The details each `bot-web/…` refusal carries: none. */
export type BotWebErrorDetails = { readonly [Code in BotWebErrorCode]: Record<string, never> }

/**
 * The `botWeb` Remote: web lookup settings shared by every bot. Secret
 * values only travel inward (`setSecret`).
 */
export interface BotWebApi {
  view(): Promise<BotWebView>
  /** The view now and again after every change. */
  watch(signal?: AbortSignal): AsyncIterable<BotWebView>
  /** Turn one capability on or off for every bot; their presets follow. */
  setEnabled(capability: BotWebCapability, enabled: boolean): Promise<BotWebView>
  /** Set, replace or clear one secret of the settings' backend. */
  setSecret(key: string, change: BotWebSecretChange): Promise<BotWebView>
  /** Try the stored secrets against the backend once. */
  test(): Promise<BotWebTestResult>
}

const BACKEND_ID = /^[a-z][a-z0-9-]*$/
const SECRET_KEY = /^[a-z][a-zA-Z0-9]*$/

/** Upper bound of a stored secret's length. */
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

/** Whether the browser should mark Web lookup: an enabled capability bots cannot use. */
export function webNeedsAttention(status: BotWebStatus): boolean {
  return BOT_WEB_CAPABILITIES.some((capability) => {
    const state = status[capability].state
    return state !== "ready" && state !== "disabled"
  })
}

/** The web provider id of bot-core's bridge, the one every bot's group selects. */
export const WEB_PROVIDER_ID = "bot-core"
