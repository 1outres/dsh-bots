import type { ExaFailure } from "./failure"
import { errorDetail } from "./map"
import type { ExaRequest } from "./request"

/** The `fetch` the client sends with (`globalThis.fetch`, or a fake in tests). */
export type FetchFunction = (url: string, init: RequestInit) => Promise<Response>

export interface ExaCall {
  readonly apiKey: string
  readonly signal: AbortSignal
}

export type ExaResponse =
  | { readonly ok: true; readonly payload: unknown }
  | { readonly ok: false; readonly failure: ExaFailure }

export const MAX_RESPONSE_BYTES = 16 * 1024 * 1024

export interface ExaClient {
  send(request: ExaRequest, call: ExaCall): Promise<ExaResponse>
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function readCapped(response: Response, limit: number): Promise<string | undefined> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ""
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return undefined
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function parse(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) }
  } catch {
    return { ok: false }
  }
}

/** POSTs JSON to `{baseURL}{path}` with the key in `x-api-key`; redirects are refused. */
export function createExaClient(deps: {
  readonly baseURL: string
  readonly fetch: FetchFunction
  readonly maxResponseBytes?: number
}): ExaClient {
  const limit = deps.maxResponseBytes ?? MAX_RESPONSE_BYTES
  const base = deps.baseURL.replace(/\/+$/, "")
  return {
    async send(request, call) {
      let body: string | undefined
      let status: number
      try {
        const response = await deps.fetch(`${base}${request.path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "x-api-key": call.apiKey,
          },
          body: JSON.stringify(request.body),
          redirect: "error",
          signal: call.signal,
        })
        status = response.status
        body = await readCapped(response, limit)
      } catch (error) {
        if (call.signal.aborted) return { ok: false, failure: { kind: "aborted" } }
        return { ok: false, failure: { kind: "unreachable", message: describe(error) } }
      }
      if (body === undefined) return { ok: false, failure: { kind: "too-large", limit } }
      const parsed = parse(body)
      if (status < 200 || status > 299) {
        const detail = parsed.ok ? errorDetail(parsed.value) : undefined
        return {
          ok: false,
          failure: { kind: "http", status, ...(detail === undefined ? {} : { detail }) },
        }
      }
      if (!parsed.ok) return { ok: false, failure: { kind: "malformed", message: "not JSON" } }
      return { ok: true, payload: parsed.value }
    },
  }
}
