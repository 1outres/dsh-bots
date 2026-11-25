// Verification only. RFC 6238 one-time codes (SHA-1, 6 digits, 30 s) from a base32 seed.
import { createHmac } from "node:crypto"

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"

export function base32Bytes(seed) {
  const clean = seed.replace(/[\s=]/g, "").toUpperCase()
  const out = []
  let bits = 0
  let value = 0
  for (const char of clean) {
    const index = ALPHABET.indexOf(char)
    if (index < 0) throw new Error("the seed is not base32")
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

export function totp(seed, at = Date.now(), step = 30) {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)))
  const digest = createHmac("sha1", base32Bytes(seed)).update(counter).digest()
  const offset = digest[digest.length - 1] & 15
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return String(code).padStart(6, "0")
}
