import type { SpaceJson, SpacePageError, SpacePageErrorCode } from "../../shared/spaces"
import type { ResolvedAccess, SpaceAccess } from "./access"
import type { SpaceEvents } from "./events"
import { parseSpaceEvent } from "./events"
import {
  apiHeaders,
  contentHeaders,
  hostSourceOf,
  MAX_REQUEST_BYTES,
  notFoundHeaders,
  notModifiedHeaders,
  plainHeaders,
  preflightHeaders,
  runtimeHeaders,
  type SpaceHeaders,
  streamHeaders,
  wrapperHeaders,
  wrapperStreamHeaders,
} from "./headers"
import type { SpaceKv } from "./kv"
import type { LiveChannel, LiveSink, SpaceLive } from "./live"
import { isDocumentPath, requestedPath } from "./paths"
import { spaceRuntime } from "./runtime"
import type { SpaceSources } from "./sources"
import { WRAPPER_TEXTS, wrapperLanguage } from "./texts"
import { wrapperHtml } from "./wrapper"

export interface SpaceHttpRequest {
  readonly method: string
  readonly path: string
  readonly query: URLSearchParams
  header(name: string): string | undefined
  body(maxBytes: number): Promise<Uint8Array | undefined>
  readonly signal: AbortSignal
}

export type SpaceHttpResponse =
  | {
      readonly kind: "body"
      readonly status: number
      readonly headers: SpaceHeaders
      readonly body: Uint8Array | ReadableStream<Uint8Array> | null
    }
  | {
      readonly kind: "stream"
      readonly headers: SpaceHeaders
      attach(sink: LiveSink): (() => void) | undefined
    }

export interface SpaceHttpDeps {
  readonly access: Pick<SpaceAccess, "resolve">
  readonly sources: Pick<SpaceSources, "serve">
  readonly kv: Pick<SpaceKv, "get" | "list" | "writable" | "fromPage">
  readonly events: Pick<SpaceEvents, "accept">
  readonly live: Pick<SpaceLive, "open" | "count">
  readonly liveLimit: number
  bot(botId: string): { readonly name: string } | undefined
  avatar(botId: string): Promise<string>
  readonly wrapperScriptHash: string
}

const encoder = new TextEncoder()

const body = (status: number, headers: SpaceHeaders, text: string | null): SpaceHttpResponse => ({
  kind: "body",
  status,
  headers,
  body: text === null ? null : encoder.encode(text),
})

const json = (status: number, value: unknown) => body(status, apiHeaders(), JSON.stringify(value))

const failure = (status: number, error: SpacePageErrorCode, message: string) =>
  json(status, { error, message } satisfies SpacePageError)

const NOT_FOUND = () =>
  body(404, notFoundHeaders(), JSON.stringify({ error: "space/not-found", message: "not found" }))

const notAllowed = (allow: string) =>
  body(405, { ...plainHeaders(), Allow: allow }, "method not allowed")

const decoder = new TextDecoder("utf-8", { fatal: true })

type Parsed =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: SpaceHttpResponse }

async function jsonBody(request: SpaceHttpRequest): Promise<Parsed> {
  const type = request.header("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (type !== "application/json") {
    return { ok: false, response: failure(415, "space/bad-request", "send application/json") }
  }
  const bytes = await request.body(MAX_REQUEST_BYTES)
  if (bytes === undefined) {
    return { ok: false, response: failure(413, "space/too-large", "the request is too large") }
  }
  try {
    return { ok: true, value: JSON.parse(decoder.decode(bytes)) }
  } catch {
    return { ok: false, response: failure(400, "space/bad-request", "the body is not JSON") }
  }
}

export function createSpaceHttp(deps: SpaceHttpDeps) {
  const stream = (
    access: ResolvedAccess,
    channel: LiveChannel,
    headers: SpaceHeaders,
  ): SpaceHttpResponse => {
    if (deps.live.count(access.spaceId) >= deps.liveLimit) {
      return failure(503, "space/unavailable", "too many pages of this Space are open")
    }
    return {
      kind: "stream",
      headers,
      attach: (sink) =>
        deps.live.open({
          spaceId: access.spaceId,
          botId: access.space.botId,
          viewer: access.viewer,
          access: access.hash,
          channel,
          sink,
        }),
    }
  }

  const api = async (
    request: SpaceHttpRequest,
    access: ResolvedAccess,
    host: string,
    token: string,
    rest: string,
  ): Promise<SpaceHttpResponse> => {
    const { space, spaceId, viewer } = access
    if (request.method === "OPTIONS") return body(204, preflightHeaders(), null)
    switch (rest) {
      case "space.js": {
        if (request.method !== "GET") return notAllowed("GET")
        return body(
          200,
          runtimeHeaders(host, token),
          spaceRuntime({
            viewer,
            revision: space.source.revision ?? 0,
            writable: deps.kv.writable(space, viewer),
          }),
        )
      }
      case "kv": {
        if (request.method === "GET") {
          const key = request.query.get("key")
          if (key !== null) {
            const value = deps.kv.get(spaceId, key)
            return value === undefined
              ? failure(404, "space/not-found", "no such key")
              : json(200, { value })
          }
          return json(200, deps.kv.list(spaceId, request.query.get("prefix") ?? ""))
        }
        if (request.method !== "POST") return notAllowed("GET, POST, OPTIONS")
        const parsed = await jsonBody(request)
        if (!parsed.ok) return parsed.response
        const outcome = await deps.kv.fromPage(space, viewer, parsed.value)
        return outcome.ok
          ? json(200, { ok: true })
          : failure(outcome.status, outcome.code, outcome.message)
      }
      case "events": {
        if (request.method !== "POST") return notAllowed("POST, OPTIONS")
        const parsed = await jsonBody(request)
        if (!parsed.ok) return parsed.response
        const event = parseSpaceEvent(parsed.value)
        if (!event.ok) {
          return event.reason === "too-large"
            ? json(200, { accepted: false, reason: "too-large" })
            : failure(400, "space/bad-request", event.message)
        }
        return json(200, deps.events.accept(space, viewer, event.name, event.data as SpaceJson))
      }
      case "live":
        if (request.method !== "GET") return notAllowed("GET")
        return stream(access, "page", streamHeaders())
      default:
        return NOT_FOUND()
    }
  }

  const content = async (
    request: SpaceHttpRequest,
    access: ResolvedAccess,
    host: string,
    token: string,
    rest: string,
  ): Promise<SpaceHttpResponse> => {
    if (request.method !== "GET" && request.method !== "HEAD") return notAllowed("GET, HEAD")
    const path = requestedPath(rest)
    if (path === undefined) return NOT_FOUND()
    const destination = request.header("sec-fetch-dest")
    if (destination === "document") return NOT_FOUND()
    if (isDocumentPath(path) && destination !== "iframe") return NOT_FOUND()
    const result = await deps.sources.serve({
      space: access.space,
      path,
      method: request.method,
      ifNoneMatch: request.header("if-none-match"),
      signal: request.signal,
    })
    switch (result.kind) {
      case "not-found":
        return NOT_FOUND()
      case "unavailable":
        return failure(503, "space/unavailable", result.reason)
      case "not-modified":
        return {
          kind: "body",
          status: 304,
          headers: notModifiedHeaders(host, token, result.etag),
          body: null,
        }
      case "body":
        return {
          kind: "body",
          status: 200,
          headers: contentHeaders(host, token, result),
          body: result.body,
        }
    }
  }

  const wrapper = async (
    request: SpaceHttpRequest,
    access: ResolvedAccess,
    host: string,
    token: string,
    rest: string,
  ): Promise<SpaceHttpResponse> => {
    if (rest === "_wrap/live") {
      if (request.method !== "GET") return notAllowed("GET")
      return stream(access, "wrapper", wrapperStreamHeaders())
    }
    if (rest !== "") return NOT_FOUND()
    if (request.method !== "GET") return notAllowed("GET")
    const bot = deps.bot(access.space.botId)
    if (bot === undefined) return NOT_FOUND()
    const texts = WRAPPER_TEXTS[wrapperLanguage(request.header("accept-language"))]
    return body(
      200,
      wrapperHeaders(host, token, deps.wrapperScriptHash),
      wrapperHtml({
        token,
        botName: bot.name,
        title: access.space.title,
        avatarDataUrl: await deps.avatar(access.space.botId),
        texts,
      }),
    )
  }

  return {
    async handle(request: SpaceHttpRequest): Promise<SpaceHttpResponse> {
      const match = /^\/bot-spaces\/([sv])\/([^/]+)\/(.*)$/.exec(request.path)
      if (match === null) return NOT_FOUND()
      const area = match[1]
      const token = match[2] ?? ""
      const rest = match[3] ?? ""
      const host = hostSourceOf(request.header("host"))
      if (host === undefined)
        return body(400, plainHeaders(), "the request has no usable Host header")
      const access = deps.access.resolve(token)
      if (access === undefined) return NOT_FOUND()
      if (area === "v") return wrapper(request, access, host, token, rest)
      if (rest.startsWith("_dsh/"))
        return api(request, access, host, token, rest.slice("_dsh/".length))
      if (request.method === "OPTIONS") return notAllowed("GET, HEAD")
      return content(request, access, host, token, rest)
    },
  }
}
