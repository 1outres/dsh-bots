import type { WebFetchRequest, WebSearchRequest } from "@deepseek-ai/dsh-web"
import type { ExaOptions } from "./options"

/** One request to the Exa API: the path under the base URL and the JSON body. */
export interface ExaRequest {
  readonly path: "/search" | "/contents"
  readonly body: Readonly<Record<string, unknown>>
}

export const DEFAULT_SEARCH_RESULTS = 10
export const MAX_SEARCH_RESULTS = 100
const TEST_QUERY = "Exa"
const TEST_HIGHLIGHT_CHARACTERS = 100

export function searchResultCount(maxResults: number | undefined): number {
  if (maxResults === undefined || !Number.isFinite(maxResults)) return DEFAULT_SEARCH_RESULTS
  return Math.min(MAX_SEARCH_RESULTS, Math.max(1, Math.floor(maxResults)))
}

export function searchRequest(request: WebSearchRequest, options: ExaOptions): ExaRequest {
  return {
    path: "/search",
    body: {
      query: request.query,
      type: options.searchType,
      numResults: searchResultCount(request.maxResults),
      contents: { [options.searchContents]: { maxCharacters: options.searchMaxCharacters } },
    },
  }
}

/** One character more than kept, so a longer page is known to be cut. */
export function fetchRequest(request: WebFetchRequest, options: ExaOptions): ExaRequest {
  return {
    path: "/contents",
    body: { urls: [request.url], text: { maxCharacters: options.fetchMaxCharacters + 1 } },
  }
}

/** The connection test: the cheapest search, billed as one. */
export function testRequest(): ExaRequest {
  return {
    path: "/search",
    body: {
      query: TEST_QUERY,
      type: "auto",
      numResults: 1,
      contents: { highlights: { maxCharacters: TEST_HIGHLIGHT_CHARACTERS } },
    },
  }
}
