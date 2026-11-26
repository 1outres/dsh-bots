import {
  WebError,
  type WebFetchResult,
  type WebSearchResult,
  type WebSearchSource,
} from "@deepseek-ai/dsh-web"
import type { ExaFailure } from "./failure"
import type { ExaOptions } from "./options"

export interface MappedSearch {
  readonly result: WebSearchResult
  readonly warnings: readonly string[]
}

export const HIGHLIGHT_SEPARATOR = " … "

type JsonRecord = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function records(value: unknown): readonly JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function texts(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map(text).filter((item): item is string => item !== undefined)
    : []
}

function malformed(message: string): WebError {
  return new WebError(`Exa answered with an unexpected response: ${message}`, "WEB_PROVIDER_ERROR")
}

function sourceOf(item: JsonRecord, url: string, options: ExaOptions): WebSearchSource {
  const title = text(item.title)
  const publishedAt = text(item.publishedDate)
  const excerpt =
    options.searchContents === "highlights"
      ? (() => {
          const highlights = texts(item.highlights)
          return highlights.length === 0
            ? {}
            : { snippet: highlights[0], summary: highlights.join(HIGHLIGHT_SEPARATOR) }
        })()
      : (() => {
          const body = text(item.text)
          return body === undefined ? {} : { summary: body }
        })()
  return {
    url,
    ...(title === undefined ? {} : { title }),
    ...excerpt,
    ...(publishedAt === undefined ? {} : { publishedAt }),
  }
}

function noticesOf(payload: JsonRecord): string | undefined {
  const notices = records(payload.notices)
    .map((notice) => text(notice.message))
    .filter((message): message is string => message !== undefined)
  return notices.length === 0
    ? undefined
    : ["Notes from Exa:", ...notices.map((message) => `- ${message}`)].join("\n")
}

function warningsOf(payload: JsonRecord): readonly string[] {
  return records(payload.warnings).flatMap((warning) => {
    const message = text(warning.message)
    if (message === undefined) return []
    const code = text(warning.code)
    return [`Exa warning${code === undefined ? "" : ` ${code}`}: ${message}`]
  })
}

export function mapSearch(payload: unknown, options: ExaOptions): MappedSearch {
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw malformed("a search response without results")
  }
  const seen = new Set<string>()
  const sources: WebSearchSource[] = []
  for (const item of records(payload.results)) {
    const url = text(item.url)
    if (url === undefined || seen.has(url)) continue
    seen.add(url)
    sources.push(sourceOf(item, url, options))
  }
  const content = noticesOf(payload)
  return {
    result: { ...(content === undefined ? {} : { content }), sources, truncated: false },
    warnings: warningsOf(payload),
  }
}

function statusOf(payload: JsonRecord, url: string): JsonRecord | undefined {
  const statuses = records(payload.statuses)
  return (
    statuses.find((status) => status.id === url) ??
    (statuses.length === 1 ? statuses[0] : undefined)
  )
}

function resultOf(payload: JsonRecord, url: string): JsonRecord | undefined {
  const results = records(payload.results)
  return (
    results.find((item) => item.url === url || item.id === url) ??
    (results.length === 1 ? results[0] : undefined)
  )
}

export function mapFetch(payload: unknown, url: string, options: ExaOptions): WebFetchResult {
  if (!isRecord(payload)) throw malformed("a contents response that is not an object")
  const status = statusOf(payload, url)
  if (status?.status === "error") {
    const error = isRecord(status.error) ? status.error : {}
    const code = error.httpStatusCode
    if (typeof code === "number" && Number.isInteger(code)) {
      return { url, statusCode: code, body: { kind: "text", content: "" }, truncated: false }
    }
    const tag = text(error.tag)
    throw new WebError(
      `Exa could not retrieve ${url}${tag === undefined ? "" : ` (${tag})`}.`,
      "WEB_PROVIDER_ERROR",
    )
  }
  const result = resultOf(payload, url)
  if (result === undefined) throw malformed(`no contents for ${url}`)
  const body = typeof result.text === "string" ? result.text : ""
  const truncated = body.length > options.fetchMaxCharacters
  return {
    url: text(result.url) ?? url,
    statusCode: 200,
    body: { kind: "text", content: truncated ? body.slice(0, options.fetchMaxCharacters) : body },
    truncated,
  }
}

export function testPayloadFailure(payload: unknown): ExaFailure | undefined {
  return isRecord(payload) && Array.isArray(payload.results)
    ? undefined
    : { kind: "malformed", message: "a search response without results" }
}

export function errorDetail(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined
  const detail = text(payload.error) ?? text(payload.message)
  return detail === undefined ? undefined : detail.slice(0, 300)
}
