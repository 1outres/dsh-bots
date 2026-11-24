/**
 * The desktop panel's `screen` stream (bot-core's `botConnectorStreams`),
 * shared by the Host relay and the browser: RFB bytes in base64 both ways
 * (the Gateway's stream items are JSON), who holds the input, and the
 * bot's request that a person take over.
 */

export const SCREEN_STREAM = "screen"

/** Who holds the input, as one viewer sees it. */
export type ScreenHolder = "agent" | "self" | "other"

/** The bot's request that a person take over (its reason is the bot's, untrusted). */
export type ScreenRequest = {
  readonly id: string
  readonly reason: string
  readonly since: number
}

/** Host to browser. */
export type ScreenDown =
  | { readonly type: "rfb"; readonly data: string }
  | {
      readonly type: "control"
      readonly holder: ScreenHolder
      readonly request: ScreenRequest | null
    }

/** Browser to Host. */
export type ScreenUp =
  | { readonly type: "rfb"; readonly data: string }
  /** Take the input from the agent or another viewer. */
  | { readonly type: "take" }
  /** Hand it back to the agent. */
  | { readonly type: "release" }
  /** Turn the bot's request down without taking over. */
  | { readonly type: "decline" }

/** Longest base64 of one `rfb` item from the browser (under the Gateway's 256 KiB uplink inbox). */
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

/** Check one item from the Host (the browser's side). @throws for anything else. */
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

/** Check one item from the browser. @throws for anything else. */
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
