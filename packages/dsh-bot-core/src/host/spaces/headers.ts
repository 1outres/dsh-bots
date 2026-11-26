import { contentPathOf, SPACE_LIMITS, wrapperPathOf } from "../../shared/spaces"

export type SpaceHeaders = Readonly<Record<string, string>>

const HOST =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/

export function hostSourceOf(host: string | undefined): string | undefined {
  if (host === undefined) return undefined
  const trimmed = host.trim()
  return trimmed.length > 0 && trimmed.length <= 255 && HOST.test(trimmed) ? trimmed : undefined
}

const COMMON: SpaceHeaders = {
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
}

const NO_STORE: SpaceHeaders = { ...COMMON, "Cache-Control": "no-store" }

const CORS: SpaceHeaders = { "Access-Control-Allow-Origin": "*" }

const JSON_TYPE = "application/json; charset=utf-8"

export const contentSource = (host: string, token: string) => `${host}${contentPathOf(token)}`

export function contentPolicy(host: string, token: string): string {
  const base = contentSource(host, token)
  return [
    "sandbox allow-scripts allow-forms",
    `default-src ${base}`,
    `script-src ${base} 'unsafe-inline'`,
    `style-src ${base} 'unsafe-inline'`,
    `img-src ${base} data: blob:`,
    `font-src ${base} data:`,
    `connect-src ${base}_dsh/`,
    `form-action ${base}_dsh/`,
    "frame-src 'none'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
  ].join("; ")
}

export function wrapperPolicy(host: string, token: string, scriptHash: string): string {
  return [
    "default-src 'none'",
    `frame-src ${contentSource(host, token)}`,
    "img-src data:",
    "style-src 'unsafe-inline'",
    `script-src 'sha256-${scriptHash}'`,
    `connect-src ${host}${wrapperPathOf(token)}_wrap/`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ")
}

export function contentHeaders(
  host: string,
  token: string,
  body: { readonly type: string; readonly etag: string; readonly bytes?: number },
): SpaceHeaders {
  return {
    ...COMMON,
    "Content-Security-Policy": contentPolicy(host, token),
    "Cache-Control": "no-cache",
    ETag: body.etag,
    "Content-Type": body.type,
    ...(body.bytes === undefined ? {} : { "Content-Length": String(body.bytes) }),
  }
}

export function runtimeHeaders(host: string, token: string): SpaceHeaders {
  return {
    ...NO_STORE,
    "Content-Security-Policy": contentPolicy(host, token),
    "Content-Type": "text/javascript; charset=utf-8",
  }
}

export const apiHeaders = (): SpaceHeaders => ({ ...NO_STORE, ...CORS, "Content-Type": JSON_TYPE })

export const streamHeaders = (): SpaceHeaders => ({
  ...NO_STORE,
  ...CORS,
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
})

export const preflightHeaders = (): SpaceHeaders => ({
  ...NO_STORE,
  ...CORS,
  "Access-Control-Allow-Methods": "GET, POST",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Max-Age": "600",
})

export const notFoundHeaders = (): SpaceHeaders => ({
  ...NO_STORE,
  ...CORS,
  "Content-Type": JSON_TYPE,
})

export const plainHeaders = (): SpaceHeaders => ({
  ...NO_STORE,
  "Content-Type": "text/plain; charset=utf-8",
})

export const notModifiedHeaders = (host: string, token: string, etag: string): SpaceHeaders => ({
  ...COMMON,
  "Content-Security-Policy": contentPolicy(host, token),
  "Cache-Control": "no-cache",
  ETag: etag,
})

export function wrapperHeaders(host: string, token: string, scriptHash: string): SpaceHeaders {
  return {
    ...NO_STORE,
    "Content-Security-Policy": wrapperPolicy(host, token, scriptHash),
    "Content-Type": "text/html; charset=utf-8",
  }
}

export const wrapperStreamHeaders = (): SpaceHeaders => ({
  ...NO_STORE,
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
})

export const MAX_REQUEST_BYTES = SPACE_LIMITS.requestBytes
