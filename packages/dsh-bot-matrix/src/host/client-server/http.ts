import { MatrixError, type MatrixFailureKind } from "../matrix"
import { type Scheduler, sleep } from "../ports"
import { errorBodySchema } from "./schemas"

export interface FetchResponse {
  readonly status: number
  readonly ok: boolean
  readonly headers: { get(name: string): string | null }
  json(): Promise<unknown>
  arrayBuffer(): Promise<ArrayBuffer>
  readonly body: AsyncIterable<Uint8Array> | null
}

export type MatrixFetch = (
  url: string,
  init: {
    readonly method: string
    readonly headers: Readonly<Record<string, string>>
    readonly body?: string | Uint8Array
    readonly signal: AbortSignal
    readonly redirect: "error"
  },
) => Promise<FetchResponse>

export interface HttpDeps {
  readonly fetch: MatrixFetch
  readonly scheduler: Scheduler
  readonly homeserver: string
  readonly asToken: string
}

export interface HttpRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE"
  readonly path: string
  readonly query?: Readonly<Record<string, string>>
  readonly json?: unknown
  readonly bytes?: { readonly data: Uint8Array; readonly contentType: string }
  readonly user?: string
  readonly authenticated?: boolean
  readonly signal: AbortSignal
}

export const MAX_RETRIES = 5
const DEFAULT_RETRY_MS = 1_000

function kindOf(status: number, errcode: string | undefined): MatrixFailureKind {
  if (errcode === "M_UNKNOWN_TOKEN" || errcode === "M_MISSING_TOKEN") return "token"
  if (errcode === "M_USER_IN_USE") return "user-in-use"
  if (errcode === "M_EXCLUSIVE") return "exclusive"
  if (errcode === "M_TOO_LARGE" || status === 413) return "too-large"
  if (errcode === "M_NOT_FOUND" || status === 404) return "not-found"
  if (errcode === "M_FORBIDDEN" || status === 403) return "forbidden"
  if (status >= 500) return "unreachable"
  return "rejected"
}

export function urlOf(
  homeserver: string,
  path: string,
  query: Readonly<Record<string, string>>,
): string {
  const url = new URL(path, homeserver.endsWith("/") ? homeserver : `${homeserver}/`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return url.toString()
}

export async function request(deps: HttpDeps, call: HttpRequest): Promise<FetchResponse> {
  const query: Record<string, string> = { ...(call.query ?? {}) }
  if (call.user !== undefined) query.user_id = call.user
  const headers: Record<string, string> = {}
  if (call.authenticated !== false) headers.authorization = `Bearer ${deps.asToken}`
  let body: string | Uint8Array | undefined
  if (call.bytes !== undefined) {
    headers["content-type"] = call.bytes.contentType
    body = call.bytes.data
  } else if (call.json !== undefined) {
    headers["content-type"] = "application/json"
    body = JSON.stringify(call.json)
  }
  const url = urlOf(deps.homeserver, call.path, query)
  for (let attempt = 0; ; attempt += 1) {
    let response: FetchResponse
    try {
      response = await deps.fetch(url, {
        method: call.method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal: call.signal,
        redirect: "error",
      })
    } catch (error) {
      if (call.signal.aborted) throw error
      throw new MatrixError(
        "unreachable",
        `the homeserver could not be reached: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    if (response.ok) return response
    const parsed = errorBodySchema.safeParse(await response.json().catch(() => undefined))
    const error = parsed.success ? parsed.data : {}
    if (response.status === 429 && attempt < MAX_RETRIES) {
      await sleep(deps.scheduler, error.retry_after_ms ?? DEFAULT_RETRY_MS, call.signal)
      continue
    }
    throw new MatrixError(
      kindOf(response.status, error.errcode),
      `${call.method} ${call.path} answered ${response.status}${error.errcode === undefined ? "" : ` ${error.errcode}`}${error.error === undefined ? "" : `: ${error.error}`}`,
      response.status,
      error.errcode,
    )
  }
}

export async function requestJson(deps: HttpDeps, call: HttpRequest): Promise<unknown> {
  const response = await request(deps, call)
  try {
    return await response.json()
  } catch {
    throw new MatrixError(
      "rejected",
      `${call.method} ${call.path} answered something other than JSON`,
    )
  }
}

export async function readLimited(response: FetchResponse, maxBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.byteLength
    if (length > maxBytes) throw new MatrixError("too-large", `it is larger than ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  const data = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return data
}
