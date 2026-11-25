/**
 * What the browser's login helpers in the bot's VM (vm/helper/) and the
 * Host say to each other over the helper's standard input and output
 * (docs/specs/bot-vaults.md §8). Every line is JSON; the only secret is
 * the raw bytes that follow a line announcing their `length`. A helper
 * answers with closed codes only, never with text of its own.
 */

/** Why a helper stopped; each has a fixed explanation for the model. */
export type HelperFailure =
  | "devtools"
  | "not-found"
  | "ambiguous"
  | "not-editable"
  | "not-password-field"
  | "not-text"
  | "opaque-origin"
  | "origin-changed"
  | "focus-lost"
  | "rejected"
  | "protocol"
  | "failed"

/** Why an offered passkey went away. */
export type PasskeyEnd = "used" | "expired" | "navigated" | "closed" | "released"

export type HelperReply =
  | { readonly kind: "located"; readonly origin: string; readonly element?: string }
  | { readonly kind: "filled"; readonly submitted: boolean }
  | { readonly kind: "ready" }
  | { readonly kind: "ended"; readonly reason: PasskeyEnd }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error"; readonly code: HelperFailure }

/** The first line to the fill helper. */
export interface FillRequest {
  readonly devtools: string
  readonly mark: string
  readonly field: "username" | "password" | "otp"
}

/** The line before the value's bytes. */
export interface FillOrder {
  readonly fill: { readonly origin: string; readonly submit: boolean; readonly length: number }
}

/** The first line to the passkey helper. */
export interface PasskeyRequest {
  readonly devtools: string
  readonly mark: string
}

/** The line before the private key's bytes (PKCS#8 DER). */
export interface PasskeyOrder {
  readonly passkey: {
    readonly origin: string
    readonly rpId: string
    readonly credentialId: string
    readonly userHandle?: string
    readonly signCount: number
    readonly seconds: number
    readonly length: number
  }
}

const FAILURES: readonly HelperFailure[] = [
  "devtools",
  "not-found",
  "ambiguous",
  "not-editable",
  "not-password-field",
  "not-text",
  "opaque-origin",
  "origin-changed",
  "focus-lost",
  "rejected",
  "protocol",
  "failed",
]
const ENDS: readonly PasskeyEnd[] = ["used", "expired", "navigated", "closed", "released"]
const ORIGIN = /^https?:\/\/[^/\s]{1,260}$/
const ELEMENT = /^(?:input:[a-z]{1,16}|textarea|contenteditable)$/

export class HelperProtocolError extends Error {
  constructor(what: string) {
    super(`the browser's login helper answered ${what}`)
    this.name = "HelperProtocolError"
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const oneKey = (value: Record<string, unknown>) => {
  const keys = Object.keys(value)
  if (keys.length !== 1) throw new HelperProtocolError("a line that is not one answer")
  return keys[0] as string
}

/** One line of a helper, checked (the VM is the bot's: untrusted). */
export function parseReply(value: unknown): HelperReply {
  if (!isRecord(value)) throw new HelperProtocolError("a line that is not an object")
  const key = oneKey(value)
  const body = value[key]
  switch (key) {
    case "located": {
      if (!isRecord(body) || typeof body.origin !== "string" || !ORIGIN.test(body.origin)) {
        throw new HelperProtocolError("a location without a web origin")
      }
      if (
        body.element !== undefined &&
        (typeof body.element !== "string" || !ELEMENT.test(body.element))
      ) {
        throw new HelperProtocolError("an unknown kind of element")
      }
      return {
        kind: "located",
        origin: body.origin,
        ...(body.element === undefined ? {} : { element: body.element }),
      }
    }
    case "filled":
      if (!isRecord(body) || typeof body.submitted !== "boolean") {
        throw new HelperProtocolError("a malformed fill")
      }
      return { kind: "filled", submitted: body.submitted }
    case "ready":
      return { kind: "ready" }
    case "ended":
      if (!(ENDS as readonly unknown[]).includes(body))
        throw new HelperProtocolError("an unknown end")
      return { kind: "ended", reason: body as PasskeyEnd }
    case "cancelled":
      return { kind: "cancelled" }
    case "error":
      return {
        kind: "error",
        code: (FAILURES as readonly unknown[]).includes(body) ? (body as HelperFailure) : "failed",
      }
    default:
      throw new HelperProtocolError("an unknown line")
  }
}
