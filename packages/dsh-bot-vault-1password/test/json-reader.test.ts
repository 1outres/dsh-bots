import { afterEach, describe, expect, it, vi } from "vitest"
import { JsonSyntaxError, readJson } from "../src/json/reader"
import { json, PASSWORD } from "./support/op-json"

const bytes = (text: string) => new TextEncoder().encode(text)

afterEach(() => {
  vi.restoreAllMocks()
})

describe("readJson", () => {
  it("reads objects, arrays, numbers and literals as spans", () => {
    const doc = readJson(bytes(' { "a" : [1, -2.5e3, true, false, null, {"b": "c"}], "d": {} } '))
    const items = doc.items(doc.member(doc.root, "a"))
    expect(items.map((item) => item.type)).toEqual([
      "number",
      "number",
      "boolean",
      "boolean",
      "null",
      "object",
    ])
    expect(doc.text(doc.member(items[5], "b"))).toBe("c")
    expect(doc.member(doc.root, "d")).toEqual({ type: "object", members: [] })
    expect(doc.member(doc.root, "missing")).toBeUndefined()
    expect(doc.text(items[0])).toBeUndefined()
    expect(doc.items(doc.root)).toEqual([])
  })

  it("resolves escapes, multi-byte text and surrogate pairs", () => {
    const value = 'q"\\/\b\f\n\r\t \u00e9 \u3042 \ud83d\ude00 \u0001'
    const doc = readJson(json({ value }))
    expect(doc.text(doc.member(doc.root, "value"))).toBe(value)
    const escaped = readJson(bytes('{"v":"\\u00e9\\ud83d\\ude00\\/"}'))
    expect(escaped.text(escaped.member(escaped.root, "v"))).toBe("\u00e9\ud83d\ude00/")
  })

  it("matches escaped keys and compares text without decoding it", () => {
    const doc = readJson(bytes('{"p\\u0075rpose":"PASS\\u0057ORD"}'))
    const decode = vi.spyOn(TextDecoder.prototype, "decode")
    const purpose = doc.member(doc.root, "purpose")
    expect(doc.isText(purpose, "PASSWORD")).toBe(true)
    expect(doc.isText(purpose, "PASSWORDS")).toBe(false)
    expect(doc.isText(doc.root, "PASSWORD")).toBe(false)
    expect(decode).not.toHaveBeenCalled()
  })

  it.each([
    "",
    "{",
    '{"a":1,}',
    "[1,]",
    '{"a" 1}',
    '"unterminated',
    '"bad \\x escape"',
    '"bad \\u12 escape"',
    '"raw\ncontrol"',
    "01",
    "1.",
    "1e",
    "-",
    "tru",
    "nul",
    "{} {}",
    '{"a":1} x',
    `[${"[".repeat(80)}${"]".repeat(81)}`,
  ])("refuses %j", (text) => {
    expect(() => readJson(bytes(text))).toThrow(JsonSyntaxError)
  })

  it("never quotes the content in a syntax error", () => {
    try {
      readJson(bytes(`{"password":"${PASSWORD}" oops}`))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(JsonSyntaxError)
      expect(String(error)).not.toContain(PASSWORD)
      expect(String(error)).toMatch(/^JsonSyntaxError: malformed JSON at byte \d+$/)
    }
  })

  it("refuses text that is not UTF-8 when decoding it", () => {
    const raw = new Uint8Array([0x22, 0xff, 0xfe, 0x22])
    const doc = readJson(raw)
    expect(() => doc.text(doc.root)).toThrow(TypeError)
  })

  it("wipes the bytes it holds and cannot be read afterwards", () => {
    const raw = json({ password: PASSWORD })
    const doc = readJson(raw)
    doc.wipe()
    expect(raw.every((byte) => byte === 0)).toBe(true)
    expect(() => doc.text(doc.member(doc.root, "password"))).toThrow(/wiped/)
  })

  it("decodes only the string asked for", () => {
    const doc = readJson(json({ name: "Example", password: PASSWORD, list: [PASSWORD] }))
    const decoded: string[] = []
    const original = TextDecoder.prototype.decode
    vi.spyOn(TextDecoder.prototype, "decode").mockImplementation(function (
      this: TextDecoder,
      ...args
    ) {
      const text = original.apply(this, args)
      decoded.push(text)
      return text
    })
    expect(doc.text(doc.member(doc.root, "name"))).toBe("Example")
    doc.member(doc.root, "list")
    doc.member(doc.root, "zzz")
    expect(decoded).toEqual(["Example"])
  })
})
