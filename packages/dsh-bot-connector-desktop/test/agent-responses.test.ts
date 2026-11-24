import { describe, expect, it } from "vitest"
import { AgentResponseError } from "../src/host/agent/check"
import { RESULTS } from "../src/host/agent/protocol"

const window = { id: "1:2", app: "soffice", role: "frame", name: "Untitled 1", active: true }

describe("the agent's answers, checked as untrusted input", () => {
  it("accepts a well-formed status and drops fields it does not know", () => {
    const status = RESULTS.status(
      { screen: { width: 1280, height: 1024 }, windows: [window], focus: null, extra: "x" },
      "status",
    )
    expect(status).toEqual({
      screen: { width: 1280, height: 1024 },
      windows: [window],
      focus: null,
    })
  })

  it("refuses wrong types, ids and sizes", () => {
    const bad = [
      { screen: { width: "1280", height: 1024 }, windows: [], focus: null },
      { screen: { width: 1280, height: 1024 }, windows: [{ ...window, id: "../x" }], focus: null },
      { screen: { width: 99_999, height: 1024 }, windows: [], focus: null },
      {
        screen: { width: 1280, height: 1024 },
        windows: [{ ...window, name: "x".repeat(5_000) }],
        focus: null,
      },
    ]
    for (const answer of bad)
      expect(() => RESULTS.status(answer, "status")).toThrow(AgentResponseError)
  })

  it("bounds texts and lists", () => {
    expect(() => RESULTS.text({ length: 1, offset: 0, text: "x".repeat(20_001) }, "text")).toThrow(
      /longer than/,
    )
    expect(() =>
      RESULTS.status(
        {
          screen: { width: 1, height: 1 },
          windows: Array.from({ length: 201 }, () => window),
          focus: null,
        },
        "status",
      ),
    ).toThrow(/more than 200/)
  })

  it("takes a tree as text or bounded JSON", () => {
    expect(RESULTS.tree({ snapshot: 3, nodes: 1, ms: 5, tree: "[3:1] frame" }, "tree").tree).toBe(
      "[3:1] frame",
    )
    expect(
      RESULTS.tree({ snapshot: 3, nodes: 1, ms: 5, tree: { id: "3:1" } }, "tree").tree,
    ).toEqual({ id: "3:1" })
    let deep: unknown = 1
    for (let index = 0; index < 120; index++) deep = [deep]
    expect(() => RESULTS.tree({ snapshot: 3, nodes: 1, ms: 5, tree: deep }, "tree")).toThrow(
      AgentResponseError,
    )
  })

  it("accepts an act result's change summary and a target that is gone", () => {
    const changes = RESULTS.act(
      {
        opened: [{ app: "soffice", role: "dialog", name: "Paragraph" }],
        active_window: { app: "soffice", role: "dialog", name: "Paragraph" },
        target: { gone: true },
      },
      "act",
    )
    expect(changes.target).toEqual({ gone: true })
    expect(() => RESULTS.act({ target: { gone: false } }, "act")).toThrow(AgentResponseError)
  })

  it("checks sheet cells' addresses", () => {
    const sheet = {
      name: "Sheet Sheet1",
      rows: 1_048_576,
      columns: 16_384,
      range: "A1:B2",
      cells: [{ address: "A1", text: "価格" }],
      truncated: false,
      window: { id: "7:1", app: "soffice", role: "frame", name: "Untitled 1" },
    }
    expect(RESULTS.sheet_read(sheet, "sheet_read").cells).toHaveLength(1)
    expect(() =>
      RESULTS.sheet_read({ ...sheet, cells: [{ address: "A1; rm", text: "" }] }, "sheet_read"),
    ).toThrow(AgentResponseError)
  })
})
