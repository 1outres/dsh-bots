import type {
  WebFetchRequest,
  WebFetchResult,
  WebSearchRequest,
  WebSearchResult,
} from "@deepseek-ai/dsh-web"
import { createExaClient, type ExaCall, type FetchFunction } from "./client"
import { type ExaTestResult, failureError, failureMessage, failureReason } from "./failure"
import { mapFetch, mapSearch, testPayloadFailure } from "./map"
import type { ExaOptions } from "./options"
import { fetchRequest, searchRequest, testRequest } from "./request"

export interface ExaDeps {
  readonly options: ExaOptions
  readonly fetch: FetchFunction
  /** Where Exa's warnings go (the Host's log). */
  warn(message: string): void
}

/** Exa's search, contents and connection test, each one request. */
export interface Exa {
  search(request: WebSearchRequest, call: ExaCall): Promise<WebSearchResult>
  fetch(request: WebFetchRequest, call: ExaCall): Promise<WebFetchResult>
  test(call: ExaCall): Promise<ExaTestResult>
}

export function createExa(deps: ExaDeps): Exa {
  const { options } = deps
  const client = createExaClient({ baseURL: options.baseURL, fetch: deps.fetch })
  return {
    async search(request, call) {
      const response = await client.send(searchRequest(request, options), call)
      if (!response.ok) throw failureError(response.failure)
      const mapped = mapSearch(response.payload, options)
      for (const warning of mapped.warnings) deps.warn(warning)
      return mapped.result
    },
    async fetch(request, call) {
      const response = await client.send(fetchRequest(request, options), call)
      if (!response.ok) throw failureError(response.failure)
      return mapFetch(response.payload, request.url, options)
    },
    async test(call) {
      const response = await client.send(testRequest(), call)
      const failure = response.ok ? testPayloadFailure(response.payload) : response.failure
      return failure === undefined
        ? { ok: true }
        : { ok: false, reason: failureReason(failure), message: failureMessage(failure) }
    },
  }
}
