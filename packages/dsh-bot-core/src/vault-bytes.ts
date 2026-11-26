import { SecretBytes, type VaultKit } from "./vault-contract"

const BASE64 = new TextEncoder().encode(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
)
const BASE64URL = new TextEncoder().encode(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
)
const PAD = 0x3d

function encode(bytes: Uint8Array, alphabet: Uint8Array, pad: boolean): Uint8Array {
  const whole = Math.floor(bytes.length / 3)
  const rest = bytes.length - whole * 3
  const length = whole * 4 + (rest === 0 ? 0 : pad ? 4 : rest + 1)
  const out = new Uint8Array(length)
  let at = 0
  for (let i = 0; i < whole * 3; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number)
    out[at++] = alphabet[(n >> 18) & 63] as number
    out[at++] = alphabet[(n >> 12) & 63] as number
    out[at++] = alphabet[(n >> 6) & 63] as number
    out[at++] = alphabet[n & 63] as number
  }
  if (rest > 0) {
    const a = bytes[whole * 3] as number
    const b = rest === 2 ? (bytes[whole * 3 + 1] as number) : 0
    const n = (a << 16) | (b << 8)
    out[at++] = alphabet[(n >> 18) & 63] as number
    out[at++] = alphabet[(n >> 12) & 63] as number
    if (rest === 2) out[at++] = alphabet[(n >> 6) & 63] as number
    else if (pad) out[at++] = PAD
    if (pad) out[at++] = PAD
  }
  return out
}

export function base64Bytes(bytes: Uint8Array): Uint8Array {
  return encode(bytes, BASE64, true)
}

export function base64UrlBytes(bytes: Uint8Array): Uint8Array {
  return encode(bytes, BASE64URL, false)
}

const HEX = new TextEncoder().encode("0123456789abcdef")
const SHORT_ESCAPES: Readonly<Record<number, number>> = {
  8: 0x62,
  9: 0x74,
  10: 0x6e,
  12: 0x66,
  13: 0x72,
  34: 0x22,
  92: 0x5c,
}

export function jsonStringBytes(bytes: Uint8Array): Uint8Array {
  let length = 0
  for (const byte of bytes) {
    length += SHORT_ESCAPES[byte] !== undefined ? 2 : byte < 0x20 ? 6 : 1
  }
  const out = new Uint8Array(length)
  let at = 0
  for (const byte of bytes) {
    const short = SHORT_ESCAPES[byte]
    if (short !== undefined) {
      out[at++] = 0x5c
      out[at++] = short
    } else if (byte < 0x20) {
      out.set([0x5c, 0x75, 0x30, 0x30, HEX[byte >> 4] as number, HEX[byte & 15] as number], at)
      at += 6
    } else {
      out[at++] = byte
    }
  }
  return out
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export function wipeBytes(...parts: readonly Uint8Array[]): void {
  for (const part of parts) part.fill(0)
}

export const VAULT_KIT: VaultKit = Object.freeze({
  secret: (bytes: Uint8Array) => SecretBytes.from(bytes),
  base64: base64Bytes,
  base64Url: base64UrlBytes,
  jsonString: jsonStringBytes,
  concat: concatBytes,
  wipe: wipeBytes,
})
