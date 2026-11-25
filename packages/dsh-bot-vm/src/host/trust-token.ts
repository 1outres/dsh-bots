/**
 * An Incus trust token (`incus config trust add --restricted --projects …`):
 * base64 of a JSON object naming the server's addresses and certificate
 * fingerprint, a one-time secret and its expiry. The whole token is what
 * `POST /1.0/certificates` takes as `trust_token` (the secret alone is
 * refused with 403).
 */
import { normalizeSha256, parseEndpointUrl } from "./endpoint"

export interface TrustToken {
  /** The token as given (trimmed): what the server takes. */
  readonly text: string
  readonly clientName: string
  /** The server certificate's SHA-256, normalized. */
  readonly fingerprint: string
  /** `host:port` addresses the server listens on. */
  readonly addresses: readonly string[]
  /** Undefined when the token does not expire. */
  readonly expiresAt: number | undefined
}

/** Incus writes Go's zero time for a token without expiry. */
const NEVER = "0001-01-01T00:00:00Z"

/** @throws with what is wrong when `text` is not a trust token. */
export function parseTrustToken(text: string): TrustToken {
  const trimmed = text.trim()
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(trimmed, "base64").toString("utf8"))
  } catch {
    throw new Error("this is not an Incus trust token (not base64 JSON)")
  }
  if (typeof raw !== "object" || raw === null) throw new Error("this is not an Incus trust token")
  const token = raw as Record<string, unknown>
  const { client_name: clientName, fingerprint, addresses, secret, expires_at: expires } = token
  if (typeof secret !== "string" || secret === "" || typeof fingerprint !== "string") {
    throw new Error("this is not an Incus trust token (no secret or fingerprint)")
  }
  if (!Array.isArray(addresses) || !addresses.every((address) => typeof address === "string")) {
    throw new Error("this Incus trust token lists no addresses")
  }
  let expiresAt: number | undefined
  if (typeof expires === "string" && expires !== "" && expires !== NEVER) {
    expiresAt = Date.parse(expires)
    if (Number.isNaN(expiresAt))
      throw new Error(`this Incus trust token has an unreadable expiry "${expires}"`)
  }
  return {
    text: trimmed,
    clientName: typeof clientName === "string" ? clientName : "",
    fingerprint: normalizeSha256(fingerprint),
    addresses: addresses as string[],
    expiresAt,
  }
}

/** The URLs a token's addresses name, in its order (the caller picks one). */
export function tokenUrls(token: TrustToken): readonly string[] {
  return token.addresses.map((address) => parseEndpointUrl(`https://${address}`).origin)
}
