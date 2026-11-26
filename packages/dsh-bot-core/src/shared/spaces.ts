export type SpaceJson =
  | null
  | boolean
  | number
  | string
  | readonly SpaceJson[]
  | { readonly [key: string]: SpaceJson }

export type SpaceVisibility = "owner" | "public"

export const SPACE_VISIBILITIES: readonly SpaceVisibility[] = ["owner", "public"]

export type SpaceSourceRef = { readonly kind: "snapshot"; readonly revision: number | null }

export interface SpaceRecord {
  readonly botId: string
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly pinned: boolean
  readonly visibility: SpaceVisibility
  readonly visitorWrites: boolean
  readonly source: SpaceSourceRef
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SpaceFileEntry {
  readonly blob: string
  readonly bytes: number
  readonly type: string
}

export interface SpaceRevision {
  readonly number: number
  readonly publishedAt: number
  readonly files: Readonly<Record<string, SpaceFileEntry>>
}

export type SpaceAccessKind = "frame" | "link" | "public"

export type SpaceIssuer = "owner" | "bot"

export interface SpaceAccessRecord {
  readonly spaceId: string
  readonly kind: Exclude<SpaceAccessKind, "frame">
  readonly label: string
  readonly reason: string | null
  readonly issuedBy: SpaceIssuer
  readonly createdAt: number
  readonly expiresAt: number | null
  readonly revokedAt: number | null
  readonly token: string | null
}

export type SpaceViewer = "owner" | "link" | "public"

export interface SpaceKvRecord {
  readonly value: SpaceJson
  readonly updatedAt: number
}

export interface SpaceSettingsRecord {
  readonly publicBaseUrl: string | null
}

const MIB = 1024 * 1024
const KIB = 1024

export const SPACE_LIMITS = {
  filesPerRevision: 200,
  fileBytes: 2 * MIB,
  revisionBytes: 10 * MIB,
  spacesPerBot: 20,
  blobBytesPerBot: 100 * MIB,
  revisionsKept: 5,
  kvKeyLength: 128,
  kvValueBytes: 64 * KIB,
  kvVisitorValueBytes: 4 * KIB,
  kvKeys: 1000,
  kvBytes: 2 * MIB,
  kvListEntries: 500,
  kvVisitorWritesPerMinute: 30,
  eventNameLength: 64,
  eventDataBytes: 16 * KIB,
  eventsPerMinute: 30,
  publicEventsPerMinute: 10,
  eventBatchMs: 3000,
  eventsPerNotice: 20,
  pendingEvents: 50,
  liveStreams: 50,
  liveKeepAliveMs: 15_000,
  frameMs: 12 * 60 * 60_000,
  linkDaysDefault: 30,
  linkDaysMax: 365,
  titleLength: 80,
  descriptionLength: 300,
  labelLength: 80,
  reasonLength: 300,
  requestBytes: 96 * KIB,
} as const

export const SPACE_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/

export const SPACE_KV_KEY = /^[A-Za-z0-9._:/-]{1,128}$/

export const SPACE_EVENT_NAME = /^[A-Za-z0-9._-]{1,64}$/

export const SPACE_TOKEN = /^[A-Za-z0-9_-]{43}$/

export const SPACE_LINK_ID = /^[0-9a-f]{12}$/

export const isSpaceSlug = (value: unknown): value is string =>
  typeof value === "string" && SPACE_SLUG.test(value)

export const isSpaceVisibility = (value: unknown): value is SpaceVisibility =>
  value === "owner" || value === "public"

export const spaceIdOf = (botId: string, slug: string) => `${botId}:${slug}`

export function parseSpaceId(
  spaceId: unknown,
): { readonly botId: string; readonly slug: string } | undefined {
  if (typeof spaceId !== "string") return undefined
  const at = spaceId.lastIndexOf(":")
  if (at <= 0) return undefined
  const botId = spaceId.slice(0, at)
  const slug = spaceId.slice(at + 1)
  return isSpaceSlug(slug) ? { botId, slug } : undefined
}

export const linkIdOf = (tokenHash: string) => tokenHash.slice(0, 12)

export const spaceViewerOf = (kind: SpaceAccessKind): SpaceViewer =>
  kind === "frame" ? "owner" : kind

export function isSpaceJson(value: unknown, depth = 0): value is SpaceJson {
  if (depth > 64) return false
  if (value === null || typeof value === "boolean" || typeof value === "string") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => isSpaceJson(item, depth + 1))
  if (typeof value !== "object") return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Object.values(value).every((item) => isSpaceJson(item, depth + 1))
}

export const SPACE_WRAPPER_PATH = "/bot-spaces/v/"

export const SPACE_CONTENT_PATH = "/bot-spaces/s/"

export const SPACE_ROUTE = "/bot-spaces"

export const wrapperPathOf = (token: string) => `${SPACE_WRAPPER_PATH}${token}/`

export const contentPathOf = (token: string) => `${SPACE_CONTENT_PATH}${token}/`

export type PublicBaseUrlParse =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string }

export function parsePublicBaseUrl(input: string): PublicBaseUrlParse {
  const text = input.trim()
  if (text.length === 0) return { ok: false, reason: "the URL is empty" }
  if (/[\s\p{Cc}]/u.test(text)) {
    return { ok: false, reason: "the URL contains whitespace or control characters" }
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, reason: "the URL is not an absolute URL" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "the URL must start with http:// or https://" }
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "the URL must not carry a user name or password" }
  }
  if (url.search !== "" || text.includes("?")) {
    return { ok: false, reason: "the URL must not have a query" }
  }
  if (url.hash !== "" || text.includes("#")) {
    return { ok: false, reason: "the URL must not have a fragment" }
  }
  const path = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`
  return { ok: true, url: `${url.protocol}//${url.host}${path}` }
}

export const publicUrlOf = (baseUrl: string, token: string) =>
  `${baseUrl}${wrapperPathOf(token).slice(1)}`

export interface BotSpaceRevisionView {
  readonly number: number
  readonly publishedAt: number
  readonly files: number
  readonly bytes: number
}

export interface BotSpaceLinkView {
  readonly id: string
  readonly label: string
  readonly issuedBy: SpaceIssuer
  readonly reason: string | null
  readonly createdAt: number
  readonly expiresAt: number
}

export interface BotSpaceView {
  readonly id: string
  readonly botId: string
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly pinned: boolean
  readonly visibility: SpaceVisibility
  readonly visitorWrites: boolean
  readonly revision: BotSpaceRevisionView | null
  readonly links: readonly BotSpaceLinkView[]
  readonly publicUrl: string | null
  readonly kv: { readonly keys: number; readonly bytes: number }
  readonly viewers: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface BotSpacesSettings {
  readonly publicBaseUrl: string | null
  readonly suggestedBaseUrl: string | null
}

export interface BotSpacesView {
  readonly spaces: readonly BotSpaceView[]
  readonly settings: BotSpacesSettings
}

export interface BotSpaceFrame {
  readonly url: string
  readonly expiresAt: number
}

export interface BotSpaceLinkRequest {
  readonly label: string
  readonly days: number
}

export interface BotSpaceLinkCreated {
  readonly id: string
  readonly url: string | null
  readonly relativeUrl: string
  readonly expiresAt: number
}

export interface BotSpaceDiscarded {
  readonly discarded: true
}

export const BOT_SPACE_ERROR_CODES = [
  "bot-space/not-found",
  "bot-space/invalid-base-url",
  "bot-space/not-owner",
] as const

export type BotSpaceErrorCode = (typeof BOT_SPACE_ERROR_CODES)[number]

export type BotSpaceErrorDetails = { readonly [Code in BotSpaceErrorCode]: Record<string, never> }

export interface BotSpacesApi {
  watch(signal?: AbortSignal): AsyncIterable<BotSpacesView>
  frame(spaceId: string): Promise<BotSpaceFrame>
  setPinned(spaceId: string, pinned: boolean): Promise<BotSpaceView>
  setVisibility(spaceId: string, visibility: SpaceVisibility): Promise<BotSpaceView>
  setVisitorWrites(spaceId: string, allowed: boolean): Promise<BotSpaceView>
  createLink(spaceId: string, request: BotSpaceLinkRequest): Promise<BotSpaceLinkCreated>
  revokeLink(spaceId: string, linkId: string): Promise<BotSpaceView>
  discard(spaceId: string): Promise<BotSpaceDiscarded>
  setPublicBaseUrl(url: string | null): Promise<BotSpacesSettings>
}

export const SPACE_PAGE_ERROR_CODES = [
  "space/not-found",
  "space/forbidden",
  "space/too-large",
  "space/rate-limited",
  "space/bad-request",
  "space/unavailable",
] as const

export type SpacePageErrorCode = (typeof SPACE_PAGE_ERROR_CODES)[number]

export interface SpacePageError {
  readonly error: SpacePageErrorCode
  readonly message: string
}

export type SpaceKvOperation =
  | { readonly op: "set"; readonly key: string; readonly value: SpaceJson }
  | { readonly op: "delete"; readonly key: string }

export interface SpaceKvEntry {
  readonly key: string
  readonly value: SpaceJson
}

export interface SpaceKvListing {
  readonly entries: readonly SpaceKvEntry[]
  readonly truncated: boolean
}

export type SpaceEventRefusal = "rate-limited" | "too-large" | "queue-full"

export type SpaceEventResult =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: SpaceEventRefusal }

export type SpaceLiveEvent =
  | { readonly event: "revision"; readonly data: { readonly number: number } }
  | { readonly event: "kv"; readonly data: { readonly key: string; readonly value?: SpaceJson } }
  | {
      readonly event: "message"
      readonly data: { readonly name: string; readonly data: SpaceJson }
    }
  | { readonly event: "gone"; readonly data: Record<string, never> }

export interface SpaceRuntimeBoot {
  readonly viewer: SpaceViewer
  readonly revision: number
  readonly writable: boolean
}
