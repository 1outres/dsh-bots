import type {
  WebFetchRequest,
  WebFetchResult,
  WebSearchRequest,
  WebSearchResult,
} from "@deepseek-ai/dsh-web"
import type { BotWebTestResult, BotWebText } from "./shared/web"

/**
 * A web lookup backend: what serves every bot's `web_search` and
 * `web_fetch`, registered with `Bot.registerWebBackend`. bot-core keeps its
 * secrets (one credential record per backend, shared by every bot) and calls
 * it only while every secret is set. Failures are thrown as `WebError`
 * (`@deepseek-ai/dsh-web`); tool-web puts their `code` on the tool's error.
 */

export type {
  BotWebCapability,
  BotWebCapabilityStatus,
  BotWebSettings,
  BotWebStatus,
  BotWebTestResult,
  BotWebText,
} from "./shared/web"

/** One secret of a backend: the key in its credential payload (camelCase) and its label. */
export interface BotWebSecretField {
  readonly key: string
  readonly label: BotWebText
}

/** One call of an operation: the bot it serves, every secret of the backend, the call's cancellation. */
export interface BotWebCall {
  readonly botId: string
  readonly secrets: Readonly<Record<string, string>>
  readonly signal: AbortSignal
}

/**
 * One operation of a backend, run where `placement` says (the Host, for now).
 * The seam (dsh-web) caps `maxResults`; tool-web's timeouts arrive through
 * `signal`; the backend bounds its own response sizes.
 */
export interface BotWebOperation<Request, Result> {
  readonly placement: "host"
  run(request: Request, call: BotWebCall): Promise<Result>
}

export interface BotWebBackend {
  /** Lowercase letters, digits and hyphens, starting with a letter. */
  readonly id: string
  readonly name: BotWebText
  /** What it costs, who fetches the target URLs, what it cannot do. */
  readonly description?: BotWebText
  /** At least one. */
  readonly secrets: readonly BotWebSecretField[]
  /** At least one of `search` and `fetch`. */
  readonly search?: BotWebOperation<WebSearchRequest, WebSearchResult>
  readonly fetch?: BotWebOperation<WebFetchRequest, WebFetchResult>
  /** One request with `secrets` to tell whether they are valid. */
  test(call: {
    readonly secrets: Readonly<Record<string, string>>
    readonly signal: AbortSignal
  }): Promise<BotWebTestResult>
}
