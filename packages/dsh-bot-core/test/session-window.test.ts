import { describe, expect, it, vi } from "vitest"
import {
  createSessionWindows,
  requiredWindow,
  WINDOW_AUTO_MAX,
  WINDOW_BASE,
  widenedWindow,
  windowRows,
} from "../src/client/session-window"

const rows = (count: number, mark: Record<number, "selected" | "running"> = {}) =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    selected: mark[index + 1] === "selected",
    running: mark[index + 1] === "running",
  }))

describe("requiredWindow", () => {
  it("reaches the selected row anywhere and running rows within the automatic maximum", () => {
    expect(requiredWindow(rows(80))).toBe(0)
    expect(requiredWindow(rows(80, { 7: "running" }))).toBe(7)
    expect(requiredWindow(rows(80, { [WINDOW_AUTO_MAX + 1]: "running" }))).toBe(0)
    expect(requiredWindow(rows(80, { 70: "selected", 9: "running" }))).toBe(70)
  })
})

describe("windowRows", () => {
  it("lists the base window and names how many more there are", () => {
    const windowed = windowRows(rows(12), undefined)
    expect(windowed.rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5])
    expect(windowed.overflow).toEqual({ kind: "more", hidden: 7 })
    expect(windowed.limit).toBe(WINDOW_BASE)
  })

  it("offers Show less once a wider window lists everything", () => {
    expect(windowRows(rows(12), 20).overflow).toEqual({ kind: "less" })
  })

  it("has no overflow row when the folded window already lists everything", () => {
    expect(windowRows(rows(5), undefined).overflow).toBeUndefined()
    expect(windowRows(rows(9, { 9: "running" }), undefined).overflow).toBeUndefined()
  })

  it("never folds a row the selection or running work needs", () => {
    const windowed = windowRows(rows(12, { 8: "running" }), undefined)
    expect(windowed.rows).toHaveLength(8)
    expect(windowed.limit).toBe(8)
    expect(windowed.overflow).toEqual({ kind: "more", hidden: 4 })
  })
})

describe("widenedWindow", () => {
  it("adds the base, or takes the rest once that few remain", () => {
    expect(widenedWindow(5, 20)).toBe(10)
    expect(widenedWindow(10, WINDOW_BASE)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("createSessionWindows", () => {
  it("widens, folds back and resets each bot apart", () => {
    const windows = createSessionWindows()
    const heard = vi.fn()
    windows.subscribe(heard)
    windows.toggle("a", { kind: "more", hidden: 20 }, 5)
    windows.toggle("b", { kind: "more", hidden: 3 }, 5)
    expect(windows.getSnapshot()).toEqual({ a: 10, b: Number.POSITIVE_INFINITY })
    windows.toggle("b", { kind: "less" }, Number.POSITIVE_INFINITY)
    expect(windows.getSnapshot()).toEqual({ a: 10 })
    windows.reset("a")
    windows.reset("a")
    expect(windows.getSnapshot()).toEqual({})
    expect(heard).toHaveBeenCalledTimes(4)
  })

  it("only ever raises a window", () => {
    const windows = createSessionWindows()
    windows.raise("a", WINDOW_BASE)
    expect(windows.getSnapshot()).toEqual({})
    windows.raise("a", 9)
    windows.raise("a", 7)
    expect(windows.getSnapshot()).toEqual({ a: 9 })
  })
})
