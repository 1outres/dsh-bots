/**
 * A JSON reader over bytes that never turns a value into a JS string unless
 * asked to (design rule 70). Parsing yields a tree of byte spans; only
 * {@link JsonDocument.text} decodes, one string node at a time, so a caller
 * reads the fields it trusts and every other value (a password, a one-time
 * code's seed) stays bytes until {@link JsonDocument.wipe} fills them with zeros.
 */

export interface JsonSpan {
  readonly start: number
  readonly end: number
}

export interface JsonStringNode {
  readonly type: "string"
  /** The bytes between the quotes, escapes not resolved. */
  readonly span: JsonSpan
  readonly escaped: boolean
}

export interface JsonMember {
  readonly key: JsonStringNode
  readonly value: JsonNode
}

export type JsonNode =
  | { readonly type: "object"; readonly members: readonly JsonMember[] }
  | { readonly type: "array"; readonly items: readonly JsonNode[] }
  | JsonStringNode
  | { readonly type: "number" | "boolean" | "null"; readonly span: JsonSpan }

/** Malformed JSON; the message names a byte offset, never the content. */
export class JsonSyntaxError extends Error {
  override readonly name = "JsonSyntaxError"
  readonly offset: number
  constructor(offset: number) {
    super(`malformed JSON at byte ${offset}`)
    this.offset = offset
  }
}

export interface JsonDocument {
  readonly root: JsonNode
  /** The value of an object's member, or undefined (not an object, no such key). */
  member(node: JsonNode | undefined, key: string): JsonNode | undefined
  /** An array's items, or none. */
  items(node: JsonNode | undefined): readonly JsonNode[]
  /** A string node decoded, or undefined for any other node. */
  text(node: JsonNode | undefined): string | undefined
  /** Whether a string node holds exactly `expected`, compared as bytes. */
  isText(node: JsonNode | undefined, expected: string): boolean
  /** Fill the bytes with zeros; the document cannot be read afterwards. */
  wipe(): void
}

const MAX_DEPTH = 64

const QUOTE = 0x22
const BACKSLASH = 0x5c
const SIMPLE_ESCAPES: Readonly<Record<number, number>> = {
  34: 0x22,
  92: 0x5c,
  47: 0x2f,
  98: 0x08,
  102: 0x0c,
  110: 0x0a,
  114: 0x0d,
  116: 0x09,
}
const LITERALS: readonly (readonly [Uint8Array, "boolean" | "null"])[] = [
  [new TextEncoder().encode("true"), "boolean"],
  [new TextEncoder().encode("false"), "boolean"],
  [new TextEncoder().encode("null"), "null"],
]

const isWhitespace = (byte: number) =>
  byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d
const isDigit = (byte: number | undefined) => byte !== undefined && byte >= 0x30 && byte <= 0x39
const hexValue = (byte: number | undefined): number => {
  if (byte === undefined) return -1
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x37
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x57
  return -1
}

function parse(bytes: Uint8Array): JsonNode {
  let at = 0
  const fail = (): never => {
    throw new JsonSyntaxError(at)
  }
  const skipWhitespace = () => {
    while (at < bytes.length && isWhitespace(bytes[at] as number)) at++
  }
  const string = (): JsonStringNode => {
    if (bytes[at] !== QUOTE) fail()
    const start = ++at
    let escaped = false
    for (;;) {
      const byte = bytes[at]
      if (byte === undefined || byte < 0x20) fail()
      if (byte === QUOTE) break
      if (byte !== BACKSLASH) {
        at++
        continue
      }
      escaped = true
      const next = bytes[at + 1]
      if (next === 0x75) {
        for (let i = 2; i < 6; i++) {
          if (hexValue(bytes[at + i]) < 0) {
            at += i
            fail()
          }
        }
        at += 6
        continue
      }
      if (next === undefined || SIMPLE_ESCAPES[next] === undefined) {
        at++
        fail()
      }
      at += 2
    }
    const span = { start, end: at }
    at++
    return { type: "string", span, escaped }
  }
  const number = (): JsonNode => {
    const start = at
    if (bytes[at] === 0x2d) at++
    if (bytes[at] === 0x30) at++
    else if (isDigit(bytes[at])) while (isDigit(bytes[at])) at++
    else fail()
    if (bytes[at] === 0x2e) {
      at++
      if (!isDigit(bytes[at])) fail()
      while (isDigit(bytes[at])) at++
    }
    if (bytes[at] === 0x65 || bytes[at] === 0x45) {
      at++
      if (bytes[at] === 0x2b || bytes[at] === 0x2d) at++
      if (!isDigit(bytes[at])) fail()
      while (isDigit(bytes[at])) at++
    }
    return { type: "number", span: { start, end: at } }
  }
  const literal = (): JsonNode => {
    for (const [word, type] of LITERALS) {
      if (word.every((byte, index) => bytes[at + index] === byte)) {
        const start = at
        at += word.length
        return { type, span: { start, end: at } }
      }
    }
    return fail()
  }
  const object = (depth: number): JsonNode => {
    at++
    const members: JsonMember[] = []
    skipWhitespace()
    if (bytes[at] === 0x7d) {
      at++
      return { type: "object", members }
    }
    for (;;) {
      skipWhitespace()
      const key = string()
      skipWhitespace()
      if (bytes[at] !== 0x3a) fail()
      at++
      members.push({ key, value: value(depth + 1) })
      skipWhitespace()
      if (bytes[at] === 0x2c) {
        at++
        continue
      }
      if (bytes[at] !== 0x7d) fail()
      at++
      return { type: "object", members }
    }
  }
  const array = (depth: number): JsonNode => {
    at++
    const items: JsonNode[] = []
    skipWhitespace()
    if (bytes[at] === 0x5d) {
      at++
      return { type: "array", items }
    }
    for (;;) {
      items.push(value(depth + 1))
      skipWhitespace()
      if (bytes[at] === 0x2c) {
        at++
        continue
      }
      if (bytes[at] !== 0x5d) fail()
      at++
      return { type: "array", items }
    }
  }
  const value = (depth: number): JsonNode => {
    if (depth > MAX_DEPTH) fail()
    skipWhitespace()
    const byte = bytes[at]
    if (byte === 0x7b) return object(depth)
    if (byte === 0x5b) return array(depth)
    if (byte === QUOTE) return string()
    if (byte === 0x2d || isDigit(byte)) return number()
    return literal()
  }
  const root = value(0)
  skipWhitespace()
  if (at !== bytes.length) fail()
  return root
}

/** A string node's bytes with escapes resolved, in a new array the caller wipes. */
function unescaped(bytes: Uint8Array, node: JsonStringNode): Uint8Array {
  const { start, end } = node.span
  if (!node.escaped) return Uint8Array.prototype.slice.call(bytes, start, end)
  const out = new Uint8Array((end - start) * 3)
  let length = 0
  const put = (codePoint: number) => {
    if (codePoint < 0x80) {
      out[length++] = codePoint
    } else if (codePoint < 0x800) {
      out[length++] = 0xc0 | (codePoint >> 6)
      out[length++] = 0x80 | (codePoint & 63)
    } else if (codePoint < 0x10000) {
      out[length++] = 0xe0 | (codePoint >> 12)
      out[length++] = 0x80 | ((codePoint >> 6) & 63)
      out[length++] = 0x80 | (codePoint & 63)
    } else {
      out[length++] = 0xf0 | (codePoint >> 18)
      out[length++] = 0x80 | ((codePoint >> 12) & 63)
      out[length++] = 0x80 | ((codePoint >> 6) & 63)
      out[length++] = 0x80 | (codePoint & 63)
    }
  }
  const unit = (at: number) =>
    (hexValue(bytes[at]) << 12) |
    (hexValue(bytes[at + 1]) << 8) |
    (hexValue(bytes[at + 2]) << 4) |
    hexValue(bytes[at + 3])
  let at = start
  while (at < end) {
    const byte = bytes[at] as number
    if (byte !== BACKSLASH) {
      out[length++] = byte
      at++
      continue
    }
    const next = bytes[at + 1] as number
    if (next !== 0x75) {
      out[length++] = SIMPLE_ESCAPES[next] as number
      at += 2
      continue
    }
    const high = unit(at + 2)
    at += 6
    if (high >= 0xd800 && high < 0xdc00 && bytes[at] === BACKSLASH && bytes[at + 1] === 0x75) {
      const low = unit(at + 2)
      if (low >= 0xdc00 && low < 0xe000) {
        put(0x10000 + ((high - 0xd800) << 10) + (low - 0xdc00))
        at += 6
        continue
      }
    }
    put(high >= 0xd800 && high < 0xe000 ? 0xfffd : high)
  }
  const result = out.slice(0, length)
  out.fill(0)
  return result
}

/**
 * Read `bytes` as JSON. The document holds the array itself (not a copy):
 * the caller wipes it with {@link JsonDocument.wipe} when done.
 * @throws JsonSyntaxError when the bytes are not one JSON value.
 */
export function readJson(bytes: Uint8Array): JsonDocument {
  const root = parse(bytes)
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let wiped = false
  const live = () => {
    if (wiped) throw new Error("the JSON document was wiped")
  }
  const isText = (node: JsonNode | undefined, expected: string): boolean => {
    live()
    if (node?.type !== "string") return false
    const want = new TextEncoder().encode(expected)
    const have = unescaped(bytes, node)
    const same = have.length === want.length && have.every((byte, index) => byte === want[index])
    have.fill(0)
    return same
  }
  return {
    root,
    member(node, key) {
      if (node?.type !== "object") return undefined
      return node.members.find((member) => isText(member.key, key))?.value
    },
    items: (node) => (node?.type === "array" ? node.items : []),
    text(node) {
      live()
      if (node?.type !== "string") return undefined
      const raw = unescaped(bytes, node)
      try {
        return decoder.decode(raw)
      } finally {
        raw.fill(0)
      }
    },
    isText,
    wipe() {
      bytes.fill(0)
      wiped = true
    },
  }
}
