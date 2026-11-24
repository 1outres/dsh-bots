import { describe, expect, it } from "vitest"
import {
  columnLabel,
  parseAddress,
  parseRange,
  planSheetWrite,
  renderSheet,
} from "../src/host/sheet"
import { execute, fakeAgent, runOf, session, toolsWith, WHERE } from "./support"

const TIMING = { focusTimeoutMs: 2000 }

describe("cell addresses", () => {
  it("convert between letters and indexes", () => {
    expect([0, 25, 26, 701, 702, 16_383].map(columnLabel)).toEqual([
      "A",
      "Z",
      "AA",
      "ZZ",
      "AAA",
      "XFD",
    ])
    expect(parseAddress("b3")).toEqual({ row: 2, column: 1 })
    expect(parseRange("C10:A1")).toEqual({
      start: { row: 0, column: 0 },
      end: { row: 9, column: 2 },
    })
    expect(() => parseAddress("A0")).toThrow()
    expect(() => parseAddress("XFE1")).toThrow(/outside a sheet/)
    expect(() => parseRange("A1:")).toThrow()
  })
})

const jump = (address: string) => [
  { kind: "key", keys: ["ctrl+shift+F5"] },
  { kind: "await_focus", role: "text", timeout_ms: 2000 },
  { kind: "type", text: address, paste: "ctrl+v" },
  { kind: "key", keys: ["Return"] },
  { kind: "await_focus", role: "table", timeout_ms: 2000 },
]

describe("writing a block of cells", () => {
  it("reaches every cell through the Name Box, types its value and enters it", () => {
    const plan = planSheetWrite(
      "2:1",
      "B2",
      [
        ["価格", 120],
        [null, "=B2*2"],
      ],
      TIMING,
    )
    expect(plan.range).toBe("B2:C3")
    expect(plan.cells).toBe(3)
    const enter = (text: string) => [
      { kind: "type", text, paste: "ctrl+v" },
      { kind: "key", keys: ["Return"] },
    ]
    expect(plan.steps).toEqual([
      { kind: "activate", id: "2:1" },
      { kind: "key", keys: ["Escape"] },
      ...jump("B2"),
      ...enter("価格"),
      ...jump("C2"),
      ...enter("120"),
      ...jump("C3"),
      ...enter("=B2*2"),
    ])
  })

  it("clears a cell for an empty string and writes booleans as Calc does", () => {
    const plan = planSheetWrite("2:1", "A1", [["", true]], TIMING)
    expect(plan.steps.slice(2)).toEqual([
      ...jump("A1"),
      { kind: "key", keys: ["Delete"] },
      ...jump("B1"),
      { kind: "type", text: "TRUE", paste: "ctrl+v" },
      { kind: "key", keys: ["Return"] },
    ])
  })

  it("refuses what one cell cannot hold, too many cells and nothing to write", () => {
    expect(() => planSheetWrite("2:1", "A1", [["a\tb"]], TIMING)).toThrow(/tabs or line breaks/)
    expect(() => planSheetWrite("2:1", "A1", [[Number.NaN]], TIMING)).toThrow(/not finite/)
    expect(() =>
      planSheetWrite("2:1", "A1", [Array.from({ length: 201 }, () => 1)], TIMING),
    ).toThrow(/at most 200/)
    expect(() => planSheetWrite("2:1", "A1", [[null]], TIMING)).toThrow(/nothing to write/)
    expect(() => planSheetWrite("2:1", "A1", [], TIMING)).toThrow(/no cells/)
    expect(() => planSheetWrite("2:1", "XFD1", [[1, 2]], TIMING)).toThrow(/outside the sheet/)
  })
})

describe("the grid", () => {
  it("lists the non-empty cells one sheet row per line", () => {
    const text = renderSheet({
      name: "Sheet Sheet1",
      rows: 1_048_576,
      columns: 16_384,
      range: "A1:O28",
      visible: "A1:O28",
      active: "B3",
      truncated: false,
      cells: [
        { address: "A1", text: "価格" },
        { address: "D1", text: "品名" },
        { address: "A2", text: "apple" },
      ],
    })
    expect(text).toBe(
      'sheet "Sheet Sheet1" (1048576x16384) range A1:O28 visible A1:O28 active B3\nA1="価格" D1="品名"\nA2="apple"',
    )
  })
})

describe("desktop_sheet", () => {
  const sheet = (range: string, cells: { address: string; text: string }[]) => ({
    name: "Sheet Sheet1",
    rows: 1_048_576,
    columns: 16_384,
    range,
    cells,
    truncated: false,
    window: {
      id: "7:1",
      app: "soffice",
      role: "frame",
      name: "Untitled 1 — LibreOffice Calc",
    },
  })

  it("writes through the sequence and answers the block read back", async () => {
    const { agent, calls } = fakeAgent({
      sheet_read: (params: { range?: string }) =>
        params.range === "B2:C2"
          ? sheet("B2:C2", [
              { address: "B2", text: "x" },
              { address: "C2", text: "1" },
            ])
          : sheet("B2:B2", []),
      sequence: () => ({ steps: 12, ...WHERE }),
    })
    const { byName } = toolsWith()
    const result = await execute(
      byName("sheet"),
      { action: "write", start: "b2", values: [["x", 1]] },
      runOf(session(agent)),
    )
    expect(calls.map((call) => call.method)).toEqual(["sheet_read", "sequence", "sheet_read"])
    expect((calls[1]?.params as { steps?: { kind: string; id?: string }[] })?.steps?.[0]).toEqual({
      kind: "activate",
      id: "7:1",
    })
    expect(result.text).toContain('B2="x" C2="1"')
  })

  it("reads the visible cells or a range", async () => {
    const { agent, calls } = fakeAgent({
      sheet_read: () => sheet("A1:B2", [{ address: "A1", text: "1" }]),
    })
    const { byName } = toolsWith()
    expect(
      (await execute(byName("sheet"), { action: "read" }, runOf(session(agent)))).text,
    ).toContain('A1="1"')
    await execute(byName("sheet"), { action: "read", range: "a1:b2" }, runOf(session(agent)))
    expect(calls[1]?.params).toEqual({ range: "A1:B2", max_cells: 480 })
    await expect(
      execute(byName("sheet"), { action: "read", range: "nope" }, runOf(session(agent))),
    ).rejects.toThrow()
  })
})
