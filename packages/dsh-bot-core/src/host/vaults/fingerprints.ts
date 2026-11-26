import { MIN_GUARDED_LENGTH } from "../../shared/vaults"
import { base64Bytes, base64UrlBytes, jsonStringBytes, wipeBytes } from "../../vault-bytes"

export interface GuardPrint {
  readonly variant: string
  readonly length: number
  readonly probe: number
  readonly digest: string
}

export interface RollingHash {
  readonly table: Uint32Array
  readonly base: number
  readonly mix: readonly [number, number]
}

export interface GuardKeys {
  readonly id: string
  readonly hash: RollingHash
  readonly salt: Uint8Array
}

export type GuardDigest = (bytes: Uint8Array, salt: Uint8Array) => Promise<string>

export const ROLLING_HASH_BYTES = 256 * 4 + 4 + 8

export const PROBE_BITS = 24

const word = (bytes: Uint8Array, at: number) =>
  (((bytes[at] as number) << 24) |
    ((bytes[at + 1] as number) << 16) |
    ((bytes[at + 2] as number) << 8) |
    (bytes[at + 3] as number)) >>>
  0

export function rollingHashFrom(material: Uint8Array): RollingHash {
  if (material.length < ROLLING_HASH_BYTES) throw new Error("the guard key material is too short")
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) table[index] = word(material, index * 4)
  return {
    table,
    base: (word(material, 1024) | 1) >>> 0,
    mix: [word(material, 1028), word(material, 1032)],
  }
}

interface Variant {
  readonly name: string
  readonly bytes: Uint8Array
}

const ALNUM = (byte: number) =>
  (byte >= 0x30 && byte <= 0x39) || (byte >= 0x41 && byte <= 0x5a) || (byte >= 0x61 && byte <= 0x7a)
const URI_MARKS = new Set([0x2d, 0x5f, 0x2e, 0x21, 0x7e, 0x2a, 0x27, 0x28, 0x29])
const FORM_MARKS = new Set([0x2a, 0x2d, 0x2e, 0x5f])
const UPPER_HEX = new TextEncoder().encode("0123456789ABCDEF")
const LOWER_HEX = new TextEncoder().encode("0123456789abcdef")

function collect(out: number[]): Uint8Array {
  const bytes = Uint8Array.from(out)
  out.fill(0)
  return bytes
}

function percentEncoded(bytes: Uint8Array, form: boolean): Uint8Array {
  const out: number[] = []
  for (const byte of bytes) {
    if (ALNUM(byte) || (form ? FORM_MARKS : URI_MARKS).has(byte)) out.push(byte)
    else if (form && byte === 0x20) out.push(0x2b)
    else out.push(0x25, UPPER_HEX[byte >> 4] as number, UPPER_HEX[byte & 15] as number)
  }
  return collect(out)
}

function hexEncoded(bytes: Uint8Array, digits: Uint8Array): Uint8Array {
  const out: number[] = []
  for (const byte of bytes) out.push(digits[byte >> 4] as number, digits[byte & 15] as number)
  return collect(out)
}

const HTML: Readonly<Record<number, Uint8Array>> = {
  38: new TextEncoder().encode("&amp;"),
  60: new TextEncoder().encode("&lt;"),
  62: new TextEncoder().encode("&gt;"),
  34: new TextEncoder().encode("&quot;"),
  39: new TextEncoder().encode("&#39;"),
}

function htmlEscaped(bytes: Uint8Array): Uint8Array {
  const out: number[] = []
  for (const byte of bytes) {
    const entity = HTML[byte]
    if (entity === undefined) out.push(byte)
    else out.push(...entity)
  }
  return collect(out)
}

function base64Phase(bytes: Uint8Array, phase: number, url: boolean): Uint8Array {
  const shifted = new Uint8Array(phase + bytes.length)
  shifted.set(bytes, phase)
  const encoded = url ? base64UrlBytes(shifted) : base64Bytes(shifted)
  wipeBytes(shifted)
  const total = phase + bytes.length
  const whole = Math.floor(total / 3)
  const rest = total % 3
  const start = phase === 0 ? 0 : phase === 1 ? 2 : 3
  const end = whole * 4 + (rest === 0 ? 0 : rest === 1 ? 1 : 2)
  const part = new Uint8Array(encoded.subarray(start, end))
  wipeBytes(encoded)
  return part
}

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, index) => byte === b[index])

export function variantsOf(bytes: Uint8Array): readonly Variant[] {
  const made: Variant[] = [
    { name: "raw", bytes: new Uint8Array(bytes) },
    { name: "json", bytes: jsonStringBytes(bytes) },
    { name: "uri", bytes: percentEncoded(bytes, false) },
    { name: "form", bytes: percentEncoded(bytes, true) },
    { name: "html", bytes: htmlEscaped(bytes) },
    { name: "hex", bytes: hexEncoded(bytes, LOWER_HEX) },
    { name: "HEX", bytes: hexEncoded(bytes, UPPER_HEX) },
  ]
  for (const phase of [0, 1, 2]) {
    made.push({ name: `base64-${phase}`, bytes: base64Phase(bytes, phase, false) })
    made.push({ name: `base64url-${phase}`, bytes: base64Phase(bytes, phase, true) })
  }
  const kept: Variant[] = []
  for (const variant of made) {
    if (
      variant.bytes.length < MIN_GUARDED_LENGTH ||
      kept.some((other) => same(other.bytes, variant.bytes))
    ) {
      wipeBytes(variant.bytes)
      continue
    }
    kept.push(variant)
  }
  return kept
}

function finalize(hash: RollingHash, h: number): number {
  let x = (h ^ hash.mix[0]) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d)
  x = (x ^ hash.mix[1]) >>> 0
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b)
  x ^= x >>> 16
  return (x >>> 0) >>> (32 - PROBE_BITS)
}

export function probeOf(hash: RollingHash, bytes: Uint8Array): number {
  let h = 0
  for (const byte of bytes) h = (Math.imul(h, hash.base) + (hash.table[byte] as number)) | 0
  return finalize(hash, h)
}

const power = (base: number, exponent: number) => {
  let result = 1
  for (let i = 0; i < exponent; i += 1) result = Math.imul(result, base)
  return result
}

export function rollWindows(
  hash: RollingHash,
  bytes: Uint8Array,
  length: number,
  visit: (start: number, probe: number) => void,
): void {
  if (bytes.length < length) return
  const drop = power(hash.base, length)
  let h = 0
  for (let index = 0; index < bytes.length; index += 1) {
    h = (Math.imul(h, hash.base) + (hash.table[bytes[index] as number] as number)) | 0
    if (index >= length) {
      h = (h - Math.imul(hash.table[bytes[index - length] as number] as number, drop)) | 0
    }
    if (index >= length - 1) visit(index - length + 1, finalize(hash, h))
  }
}

export async function printsOf(
  bytes: Uint8Array,
  keys: GuardKeys,
  digest: GuardDigest,
): Promise<readonly GuardPrint[]> {
  if (bytes.length < MIN_GUARDED_LENGTH) return []
  const variants = variantsOf(bytes)
  try {
    const prints: GuardPrint[] = []
    for (const variant of variants) {
      prints.push({
        variant: variant.name,
        length: variant.bytes.length,
        probe: probeOf(keys.hash, variant.bytes),
        digest: await digest(variant.bytes, keys.salt),
      })
    }
    return prints
  } finally {
    for (const variant of variants) wipeBytes(variant.bytes)
  }
}

export interface OwnedPrint extends GuardPrint {
  readonly grantId: string
  readonly kind: string
}

export interface PrintMatch {
  readonly start: number
  readonly end: number
  readonly print: OwnedPrint
}

export type DigestCache = Map<string, string>

function windowKey(hash: RollingHash, window: Uint8Array): string {
  let a = hash.mix[0] | 0
  let b = hash.mix[1] | 0
  for (const byte of window) {
    a = Math.imul(a ^ (hash.table[byte] as number), 0x01000193)
    b = Math.imul(b + (hash.table[(byte + 0x5b) & 255] as number), 0x5bd1e995) ^ (b >>> 13)
  }
  return `${window.length}:${(a >>> 0).toString(36)}:${(b >>> 0).toString(36)}`
}

export type PrintIndex = ReadonlyMap<number, ReadonlyMap<number, readonly OwnedPrint[]>>

export function indexPrints(prints: readonly OwnedPrint[]): PrintIndex {
  const byLength = new Map<number, Map<number, OwnedPrint[]>>()
  for (const print of prints) {
    const probes = byLength.get(print.length) ?? new Map<number, OwnedPrint[]>()
    probes.set(print.probe, [...(probes.get(print.probe) ?? []), print])
    byLength.set(print.length, probes)
  }
  return byLength
}

export async function findPrints(
  bytes: Uint8Array,
  byLength: PrintIndex,
  keys: GuardKeys,
  digest: GuardDigest,
  cache: DigestCache = new Map(),
): Promise<readonly PrintMatch[]> {
  if (byLength.size === 0) return []
  const candidates: { start: number; length: number; prints: readonly OwnedPrint[] }[] = []
  for (const [length, probes] of byLength) {
    rollWindows(keys.hash, bytes, length, (start, probe) => {
      const hit = probes.get(probe)
      if (hit !== undefined) candidates.push({ start, length, prints: hit })
    })
  }
  const matches: PrintMatch[] = []
  for (const candidate of candidates) {
    const window = new Uint8Array(
      bytes.subarray(candidate.start, candidate.start + candidate.length),
    )
    let found: string
    try {
      const key = windowKey(keys.hash, window)
      const known = cache.get(key)
      found = known ?? (await digest(window, keys.salt))
      if (known === undefined) cache.set(key, found)
    } finally {
      wipeBytes(window)
    }
    const print = candidate.prints.find((each) => constantTimeEqual(each.digest, found))
    if (print !== undefined) {
      matches.push({ start: candidate.start, end: candidate.start + candidate.length, print })
    }
  }
  return matches.sort((a, b) => a.start - b.start || b.end - a.end)
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let index = 0; index < a.length; index += 1)
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return diff === 0
}
