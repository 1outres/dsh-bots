import { describe, expect, it } from "vitest"
import { cellsOf, formatForDiscord, widthOf } from "../src/host/format"
import { splitMessage } from "../src/host/split"

describe("formatForDiscord", () => {
  it("turns a table into an aligned code block, wide characters counted twice", () => {
    expect(
      formatForDiscord(
        [
          "Results:",
          "",
          "| 名前 | **score** |",
          "|:-----|------:|",
          "| Alice | 10 |",
          "| ボブ | `7` |",
          "",
          "done",
        ].join("\n"),
      ),
    ).toBe(
      [
        "Results:",
        "",
        "```",
        "名前  | score",
        "------+------",
        "Alice | 10",
        "ボブ  | 7",
        "```",
        "",
        "done",
      ].join("\n"),
    )
  })

  it("leaves code blocks, and pipes outside a table, as they are", () => {
    const text = ["```", "| a | b |", "|---|---|", "```", "a | b is not a table"].join("\n")
    expect(formatForDiscord(text)).toBe(text)
  })

  it("turns deep headings bold and rules into a line Discord shows", () => {
    expect(formatForDiscord("### kept\n#### Deep ###\n---\n* * *\ntext")).toBe(
      "### kept\n**Deep**\n──────────\n──────────\ntext",
    )
  })

  it("reads escaped pipes and short rows", () => {
    expect(cellsOf("| a \\| b | c |")).toEqual(["a | b", "c"])
    expect(formatForDiscord("a | b\n--|--\n| only |")).toBe("```\na    | b\n-----+--\nonly |\n```")
    expect(widthOf("aあ😀")).toBe(5)
  })

  it("keeps a long table split into messages with its code block reopened", () => {
    const rows = Array.from({ length: 200 }, (_, index) => `| row ${index} | value ${index} |`)
    const chunks = splitMessage(formatForDiscord(["| k | v |", "|---|---|", ...rows].join("\n")))
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000)
      expect(chunk.startsWith("```")).toBe(true)
      expect(chunk.endsWith("```")).toBe(true)
    }
  })
})
