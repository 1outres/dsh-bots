import { describe, expect, it } from "vitest"
import { MESSAGE_LIMIT, splitMessage } from "../src/host/split"

describe("splitMessage", () => {
  it("keeps a short message whole", () => {
    expect(splitMessage("  hello  ")).toEqual(["hello"])
    expect(splitMessage("")).toEqual([])
  })

  it("never exceeds Discord's limit and loses no text", () => {
    const text = Array.from(
      { length: 300 },
      (_, index) => `line ${index} ${"x".repeat(index % 40)}`,
    ).join("\n")
    const chunks = splitMessage(text)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(MESSAGE_LIMIT)
    expect(chunks.join("\n")).toBe(text)
  })

  it("prefers a paragraph, then a line, then a word boundary", () => {
    const paragraph = `${"a".repeat(70)}\n\n${"b".repeat(40)}`
    expect(splitMessage(paragraph, 100)).toEqual(["a".repeat(70), "b".repeat(40)])
    const words = `${"word ".repeat(30)}end`
    for (const chunk of splitMessage(words, 64)) {
      expect(chunk.startsWith(" ")).toBe(false)
      expect(chunk.endsWith("wor")).toBe(false)
    }
  })

  it("cuts a word without spaces at the limit, never inside a surrogate pair", () => {
    const emoji = "😀".repeat(50)
    const chunks = splitMessage(emoji, 65)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(65)
      expect(chunk).not.toMatch(/[\uD800-\uDBFF]$/)
    }
    expect(chunks.join("")).toBe(emoji)
  })

  it("closes a code block cut in two and opens it again with its language", () => {
    const code = Array.from({ length: 30 }, (_, index) => `const v${index} = ${index}`).join("\n")
    const chunks = splitMessage(`Here:\n\`\`\`ts\n${code}\n\`\`\`\nDone.`, 200)
    expect(chunks.length).toBeGreaterThan(2)
    for (const [index, chunk] of chunks.entries()) {
      expect(chunk.length).toBeLessThanOrEqual(200)
      const fences = chunk.split("\n").filter((line) => line.startsWith("```"))
      expect(fences.length % 2, `chunk ${index} balances its fences`).toBe(0)
      if (index > 0 && index < chunks.length - 1) expect(chunk.startsWith("```ts\n")).toBe(true)
    }
    expect(chunks.at(-1)?.endsWith("Done.")).toBe(true)
  })
})
