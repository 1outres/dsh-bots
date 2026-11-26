import type {
  WebFetchRequest,
  WebFetchResult,
  WebSearchRequest,
  WebSearchResult,
} from "@deepseek-ai/dsh-web"
import type { BotWebTestResult, BotWebText } from "./shared/web"

export type {
  BotWebCapability,
  BotWebCapabilityStatus,
  BotWebSettings,
  BotWebStatus,
  BotWebTestResult,
  BotWebText,
} from "./shared/web"

export interface BotWebSecretField {
  readonly key: string
  readonly label: BotWebText
}

export interface BotWebCall {
  readonly botId: string
  readonly secrets: Readonly<Record<string, string>>
  readonly signal: AbortSignal
}

export interface BotWebOperation<Request, Result> {
  readonly placement: "host"
  run(request: Request, call: BotWebCall): Promise<Result>
}

export interface BotWebBackend {
  readonly id: string
  readonly name: BotWebText
  readonly description?: BotWebText
  readonly secrets: readonly BotWebSecretField[]
  readonly search?: BotWebOperation<WebSearchRequest, WebSearchResult>
  readonly fetch?: BotWebOperation<WebFetchRequest, WebFetchResult>
  test(call: {
    readonly secrets: Readonly<Record<string, string>>
    readonly signal: AbortSignal
  }): Promise<BotWebTestResult>
}
