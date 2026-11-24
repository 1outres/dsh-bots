import { describe, expect, it } from "vitest"
import {
  filterTools,
  looseningOf,
  overriddenCount,
  permissionChange,
  resetChange,
  resetChanges,
  toolRows,
} from "../src/client/connector-tools"
import { probeView } from "./support/connectors-client"

const rowsOf = (overrides: Record<string, "allow" | "ask" | "disallow"> = {}) =>
  toolRows(probeView({ overrides }))
const row = (name: string, overrides: Record<string, "allow" | "ask" | "disallow"> = {}) => {
  const found = rowsOf(overrides).find((item) => item.tool.name === name)
  if (found === undefined) throw new Error(name)
  return found
}

describe("connector tools", () => {
  it("joins each tool, in the connector's order, with the bot's permission", () => {
    const rows = rowsOf({ echo: "ask" })
    expect(
      rows.map((item) => [item.tool.toolName, item.default, item.override, item.effective]),
    ).toEqual([
      ["probe_echo", "allow", "ask", "ask"],
      ["probe_send", "ask", undefined, "ask"],
      ["probe_unsafe", "disallow", undefined, "disallow"],
    ])
    expect(rows[0]?.connectorId).toBe("probe")
  })

  it("refuses a view that lacks a tool's permission", () => {
    const view = probeView()
    expect(() => toolRows({ ...view, permissions: view.permissions.slice(1) })).toThrow(
      /no permission of "echo"/,
    )
  })

  it("counts the overrides", () => {
    expect(overriddenCount(rowsOf({ echo: "ask" }))).toBe(1)
    expect(overriddenCount(rowsOf())).toBe(0)
  })

  it("filters by every word, the names in the connector first, then the descriptions", () => {
    const rows = rowsOf()
    expect(filterTools(rows, "  ").length).toBe(3)
    expect(filterTools(rows, "SE").map((item) => item.tool.name)).toEqual(["send"])
    expect(filterTools(rows, "text echo").map((item) => item.tool.name)).toEqual(["echo"])
    expect(filterTools(rows, "code").map((item) => item.tool.name)).toEqual(["unsafe"])
    expect(filterTools(rows, "a").map((item) => item.tool.name)).toEqual(["unsafe", "echo", "send"])
    expect(filterTools(rows, "probe")).toEqual([])
  })

  it("drops the override when the default is picked and changes nothing twice", () => {
    expect(permissionChange(row("echo"), "ask")).toEqual({
      connectorId: "probe",
      tool: "echo",
      permission: "ask",
    })
    expect(permissionChange(row("echo"), "allow")).toBeUndefined()
    expect(permissionChange(row("echo", { echo: "ask" }), "ask")).toBeUndefined()
    expect(permissionChange(row("echo", { echo: "ask" }), "allow")).toEqual({
      connectorId: "probe",
      tool: "echo",
      permission: null,
    })
    expect(resetChange(row("echo"))).toBeUndefined()
    expect(
      resetChanges(rowsOf({ echo: "ask", unsafe: "ask" })).map((change) => change.tool),
    ).toEqual(["echo", "unsafe"])
  })

  it("asks first only for letting a tool run without asking against its default", () => {
    const send = row("send")
    expect(looseningOf(send, { connectorId: "probe", tool: "send", permission: "allow" })).toBe(
      "ask",
    )
    const unsafe = row("unsafe")
    expect(looseningOf(unsafe, { connectorId: "probe", tool: "unsafe", permission: "allow" })).toBe(
      "disallow",
    )
    expect(
      looseningOf(unsafe, { connectorId: "probe", tool: "unsafe", permission: "ask" }),
    ).toBeUndefined()
    expect(
      looseningOf(send, { connectorId: "probe", tool: "send", permission: "disallow" }),
    ).toBeUndefined()
    const echo = row("echo", { echo: "ask" })
    expect(
      looseningOf(echo, { connectorId: "probe", tool: "echo", permission: null }),
    ).toBeUndefined()
    const reset = row("send", { send: "disallow" })
    expect(
      looseningOf(reset, { connectorId: "probe", tool: "send", permission: null }),
    ).toBeUndefined()
    const allowed = row("send", { send: "allow" })
    expect(
      looseningOf(allowed, { connectorId: "probe", tool: "send", permission: "allow" }),
    ).toBeUndefined()
  })
})
