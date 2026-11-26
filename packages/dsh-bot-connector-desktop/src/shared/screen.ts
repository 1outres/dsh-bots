export const SCREEN_STREAM = "screen"

export type ScreenHolder = "agent" | "self" | "other"

export type ScreenRequest = {
  readonly id: string
  readonly reason: string
  readonly since: number
}

export type ScreenDown =
  | { readonly type: "rfb"; readonly data: string }
  | {
      readonly type: "control"
      readonly holder: ScreenHolder
      readonly request: ScreenRequest | null
    }

export type ScreenUp =
  | { readonly type: "rfb"; readonly data: string }
  | { readonly type: "take" }
  | { readonly type: "release" }
  | { readonly type: "decline" }

export const MAX_UP_RFB_CHARS = 192 * 1024

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

const HOLDERS: readonly ScreenHolder[] = ["agent", "self", "other"]

function requestOf(value: unknown): ScreenRequest | null {
  if (value === null) return null
  const request = value as Readonly<Record<string, unknown>>
  if (
    typeof value !== "object" ||
    typeof request.id !== "string" ||
    typeof request.reason !== "string" ||
    typeof request.since !== "number"
  ) {
    throw new Error("a control item's request is malformed")
  }
  return { id: request.id, reason: request.reason, since: request.since }
}

export function parseScreenDown(value: unknown): ScreenDown {
  const item = (typeof value === "object" && value !== null ? value : {}) as Readonly<
    Record<string, unknown>
  >
  if (item.type === "rfb" && typeof item.data === "string") return { type: "rfb", data: item.data }
  if (item.type === "control" && HOLDERS.includes(item.holder as ScreenHolder)) {
    return {
      type: "control",
      holder: item.holder as ScreenHolder,
      request: requestOf(item.request),
    }
  }
  throw new Error("unknown screen item from the Host")
}

export function parseScreenUp(value: unknown): ScreenUp {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("a screen item must be an object")
  }
  const item = value as Readonly<Record<string, unknown>>
  const keys = Object.keys(item)
  switch (item.type) {
    case "take":
    case "release":
    case "decline":
      if (keys.length !== 1) throw new Error(`a ${item.type} item has no other fields`)
      return { type: item.type }
    case "rfb":
      if (
        keys.length !== 2 ||
        typeof item.data !== "string" ||
        item.data.length > MAX_UP_RFB_CHARS ||
        item.data.length % 4 !== 0 ||
        !BASE64.test(item.data)
      ) {
        throw new Error(`an rfb item carries base64 data of at most ${MAX_UP_RFB_CHARS} characters`)
      }
      return { type: "rfb", data: item.data }
    default:
      throw new Error("unknown screen item")
  }
}
