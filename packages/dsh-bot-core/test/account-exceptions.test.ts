import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import {
  accountExceptions,
  connectorAccounts,
  exceptionCandidates,
  toolRows,
} from "../src/client/connector-tools"
import { AccountExceptions } from "../src/client/settings/AccountExceptions"
import type { BotConnectorView, ConnectorPermission } from "../src/shared/connectors"
import { t } from "./support/client"
import { probeView } from "./support/connectors-client"

type Overrides = Readonly<Record<string, Readonly<Record<string, ConnectorPermission>>>>

/** The probe connector acting as alice (a) and bob (b), with each account's overrides by tool. */
function withAccounts(overrides: Overrides = {}): BotConnectorView {
  const view = probeView({ enabled: true })
  const ids = ["a", "b"]
  return {
    ...view,
    accounts: [
      {
        connectionId: "a",
        label: "alice",
        email: "alice@example.com",
        status: "active",
        granted: true,
      },
      { connectionId: "b", label: "bob", status: "active", granted: true },
    ],
    permissions: view.permissions.map((entry) => ({
      ...entry,
      accounts: ids.map((connectionId) => {
        const override = overrides[connectionId]?.[entry.tool]
        return {
          connectionId,
          ...(override === undefined ? {} : { override }),
          effective: override ?? entry.effective,
        }
      }),
    })),
  }
}

const choices = (["allow", "ask", "disallow"] as const).map((value) => ({ value, label: value }))

const render = (view: BotConnectorView) =>
  renderToStaticMarkup(
    createElement(AccountExceptions, {
      t,
      rows: toolRows(view),
      choices,
      pending: [],
      onChange: async () => {},
    }),
  )

describe("account exceptions", () => {
  it("lists only the tools an account differs on, account by account", () => {
    const rows = toolRows(
      withAccounts({ b: { echo: "ask" }, a: { unsafe: "ask", echo: "disallow" } }),
    )
    expect(connectorAccounts(rows).map((account) => account.name)).toEqual([
      "alice@example.com",
      "bob",
    ])
    expect(
      accountExceptions(rows).map(({ row, account }) => [
        account.connectionId,
        row.tool.name,
        account.effective,
      ]),
    ).toEqual([
      ["a", "echo", "disallow"],
      ["a", "unsafe", "ask"],
      ["b", "echo", "ask"],
    ])
  })

  it("offers an account the tools it follows the tool's permission of", () => {
    const rows = toolRows(withAccounts({ a: { echo: "ask" } }))
    expect(exceptionCandidates(rows, "a").map((row) => row.tool.name)).toEqual(["send", "unsafe"])
    expect(exceptionCandidates(rows, "b").map((row) => row.tool.name)).toEqual([
      "echo",
      "send",
      "unsafe",
    ])
    expect(exceptionCandidates(rows, "gone")).toEqual([])
  })

  it("draws a row per exception and an add row, nothing for a connector without accounts", () => {
    const html = render(withAccounts({ b: { send: "allow" } }))
    expect(html).toContain("connectors.tools.perAccount")
    expect(html).toMatch(/data-dshb-tool-exception="bob:probe_send"/)
    expect(html).toContain("data-dshb-tool-exception-add")
    expect(html).not.toContain("<select")
    expect(render(probeView())).toBe("")
  })
})
