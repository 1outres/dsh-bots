import { describe, expect, it } from "vitest"
import { defineConnectorTool } from "../src/connector-contract"
import type { BotConnector } from "../src/contract"
import { advance, type ConnectorActionEvent, canonicalJson } from "../src/host/connectors/action"
import { connectorProblem, createConnectorCatalog } from "../src/host/connectors/catalog"
import { createDeadlines } from "../src/host/connectors/deadlines"
import type { PermissionRecord } from "../src/host/connectors/domain"
import { createConnectorPermissions } from "../src/host/connectors/permissions"
import { createConnectorToolSurface } from "../src/host/connectors/tools"
import type { ConnectorAction, ConnectorActionState } from "../src/shared/connectors"
import { memoryTable } from "./channels-support"
import { brokerSetup, mailConnector, manualClock } from "./connectors-support"

const origin = { kind: "web" } as const
const events: Record<ConnectorActionEvent["kind"], ConnectorActionEvent> = {
  approve: { kind: "approve", origin, at: 2 },
  reject: { kind: "reject", origin, at: 2 },
  expire: { kind: "expire", at: 2 },
  cancel: { kind: "cancel", at: 2 },
  start: { kind: "start", at: 3 },
  succeed: { kind: "succeed", at: 4, result: { ok: 1 } },
  fail: { kind: "fail", at: 4, reason: "no" },
  interrupt: { kind: "interrupt", at: 4 },
}
const decision = { decision: "approve", origin, at: 2 } as const
const statusOf: Record<ConnectorActionState, ConnectorAction["status"]> = {
  pending: { state: "pending" },
  approved: { state: "approved", decision },
  executing: { state: "executing", decision, startedAt: 3 },
  succeeded: { state: "succeeded", decision, startedAt: 3, finishedAt: 4, result: null },
  failed: { state: "failed", decision, startedAt: 3, finishedAt: 4, reason: "x" },
  interrupted: { state: "interrupted", decision, startedAt: 3, finishedAt: 4 },
  rejected: { state: "rejected", decision: { ...decision, decision: "reject" } },
  expired: { state: "expired", finishedAt: 2 },
  cancelled: { state: "cancelled", finishedAt: 2 },
}
const action = (state: ConnectorActionState): ConnectorAction => ({
  id: "a",
  botId: "b",
  connectorId: "mail",
  tool: "send",
  args: {},
  preview: { title: "t", fields: [] },
  sessionId: "s",
  createdAt: 1,
  expiresAt: 10,
  status: statusOf[state],
})

describe("connector action state machine", () => {
  const allowed: Record<
    ConnectorActionState,
    Partial<Record<ConnectorActionEvent["kind"], ConnectorActionState>>
  > = {
    pending: { approve: "approved", reject: "rejected", expire: "expired", cancel: "cancelled" },
    approved: { start: "executing", fail: "failed" },
    executing: { succeed: "succeeded", fail: "failed", interrupt: "interrupted" },
    succeeded: {},
    failed: {},
    interrupted: {},
    rejected: {},
    expired: {},
    cancelled: {},
  }
  for (const [from, table] of Object.entries(allowed) as [
    ConnectorActionState,
    Partial<Record<ConnectorActionEvent["kind"], ConnectorActionState>>,
  ][]) {
    for (const [kind, event] of Object.entries(events) as [
      ConnectorActionEvent["kind"],
      ConnectorActionEvent,
    ][]) {
      const to = table[kind]
      it(`${from} + ${kind} -> ${to ?? "refused"}`, () => {
        const result = advance(action(from), event)
        if (to === undefined) expect(result).toEqual({ ok: false, from })
        else expect(result.ok && result.action.status.state).toBe(to)
      })
    }
  }

  it("keeps the decision through execution", () => {
    const approved = advance(action("pending"), events.approve)
    const started = approved.ok ? advance(approved.action, events.start) : approved
    const done = started.ok ? advance(started.action, events.succeed) : started
    expect(done.ok && done.action.status).toEqual({
      state: "succeeded",
      decision,
      startedAt: 3,
      finishedAt: 4,
      result: { ok: 1 },
    })
  })

  it("writes equal arguments as equal text", () => {
    expect(canonicalJson({ b: [1, { d: 1, c: 2 }], a: "x" })).toBe(
      canonicalJson({ a: "x", b: [1, { c: 2, d: 1 }] }),
    )
  })
})

describe("connector catalog", () => {
  const tool = (overrides: object = {}) =>
    defineConnectorTool({
      name: "send",
      description: "Send.",
      parameters: {},
      permission: "ask",
      preview: () => ({ title: "t", fields: [] }),
      execute: async () => ({}),
      ...overrides,
    })
  const connector = (overrides: Partial<BotConnector> = {}): BotConnector => ({
    id: "mail",
    name: "Mail",
    sessions: "main",
    tools: [tool()],
    ...overrides,
  })

  it("refuses malformed connectors", () => {
    expect(connectorProblem(connector())).toBeUndefined()
    expect(connectorProblem(connector({ id: "Mail" }))).toMatch(/lower-case/)
    expect(connectorProblem(connector({ id: "connector" }))).toMatch(/bot-core's own/)
    expect(connectorProblem(connector({ tools: [] }))).toMatch(/no tools/)
    expect(connectorProblem(connector({ tools: [tool(), tool()] }))).toMatch(/declared twice/)
    expect(connectorProblem(connector({ tools: [tool({ permission: "maybe" })] }))).toMatch(
      /permission/,
    )
    expect(
      connectorProblem(connector({ tools: [tool({ ask: { waitMs: 5, ttlMs: 5 } })] })),
    ).toMatch(/ttlMs/)
    expect(connectorProblem(connector({ tools: [tool({ ask: { waitMs: -1 } })] }))).toMatch(
      /waitMs/,
    )
    expect(
      connectorProblem(connector({ tools: [tool({ parameters: { x: { type: "date" } } })] })),
    ).toMatch(/invalid parameters/)
    expect(connectorProblem(connector({ tools: [tool({ name: "x".repeat(60) })] }))).toMatch(
      /longer than 64/,
    )
  })

  it("refuses a taken id or tool name and forgets an unregistered connector", () => {
    const catalog = createConnectorCatalog()
    const off = catalog.register(connector({ id: "a_b", tools: [tool({ name: "c" })] }))
    expect(() => catalog.register(connector({ id: "a_b" }))).toThrow(/already registered/)
    expect(() => catalog.register(connector({ id: "a", tools: [tool({ name: "b_c" })] }))).toThrow(
      /a_b_c/,
    )
    expect(catalog.tool("a_b", "c")?.name).toBe("a_b_c")
    off()
    expect(catalog.tools()).toEqual([])
  })
})

describe("connector permissions", () => {
  it("are each tool's default until a bot overrides them", async () => {
    const catalog = createConnectorCatalog()
    catalog.register(mailConnector())
    const records = memoryTable<PermissionRecord>()
    const permissions = createConnectorPermissions({ records, catalog, now: () => 7 })
    const changes: string[] = []
    permissions.subscribe((botId) => changes.push(botId))
    expect(permissions.effective("b", "mail", "send")).toBe("ask")
    await permissions.set("b", { connectorId: "mail", tool: "send", permission: "allow" })
    expect(permissions.effective("b", "mail", "send")).toBe("allow")
    expect(permissions.effective("c", "mail", "send")).toBe("ask")
    expect(permissions.list("b")[1]).toEqual({
      connectorId: "mail",
      tool: "send",
      default: "ask",
      override: "allow",
      effective: "allow",
    })
    await permissions.set("b", { connectorId: "mail", tool: "send", permission: null })
    expect(permissions.effective("b", "mail", "send")).toBe("ask")
    await expect(
      permissions.set("b", { connectorId: "mail", tool: "nope", permission: "allow" }),
    ).rejects.toThrow(/no registered/)
    await permissions.set("gone", { connectorId: "mail", tool: "echo", permission: "ask" })
    await permissions.purge((botId) => botId !== "gone")
    expect(records.rows.size).toBe(0)
    expect(changes).toEqual(["b", "b", "gone", "gone"])
  })
})

describe("deadlines", () => {
  it("chain timers longer than the limit and fire due ones at once", async () => {
    const clock = manualClock(0)
    const deadlines = createDeadlines({ later: clock.later, now: clock.now, maxDelayMs: 100 })
    const fired: string[] = []
    deadlines.arm("far", 350, () => fired.push("far"))
    deadlines.arm("past", -1, () => fired.push("past"))
    deadlines.arm("gone", 50, () => fired.push("gone"))
    deadlines.disarm("gone")
    await clock.advance(349)
    expect(fired).toEqual(["past"])
    await clock.advance(1)
    expect(fired).toEqual(["past", "far"])
  })
})

describe("connector tool surface", () => {
  it("shows tools of enabled connectors that are not disallowed, and the pending tools with them, and follows changes", async () => {
    const setup = brokerSetup()
    const { catalog, permissions, connector, enable } = setup
    const surface = createConnectorToolSurface(setup)
    const seen: string[][] = []
    surface.watch("b1", (tools) => seen.push(tools.map((tool) => tool.name)))
    const off = catalog.register(connector)
    await enable(connector, ["b1"])
    await permissions.set("b1", { connectorId: "mail", tool: "echo", permission: "disallow" })
    await permissions.set("b1", { connectorId: "mail", tool: "hidden", permission: "allow" })
    await permissions.set("b2", { connectorId: "mail", tool: "echo", permission: "ask" })
    await setup.settings.configure("b1", connector, { enabled: false, values: {} })
    await setup.settings.configure("b1", connector, { enabled: true, values: {} })
    off()
    expect(seen).toEqual([
      [],
      ["mail_echo", "mail_send", "connector_pending_list", "connector_pending_cancel"],
      ["mail_send", "connector_pending_list", "connector_pending_cancel"],
      ["mail_send", "mail_hidden", "connector_pending_list", "connector_pending_cancel"],
      [],
      ["mail_send", "mail_hidden", "connector_pending_list", "connector_pending_cancel"],
      [],
    ])
    catalog.register(connector)
    expect(surface.route("b1", "mail_send")).toEqual({
      kind: "connector",
      connectorId: "mail",
      tool: "send",
    })
    expect(surface.route("b1", "mail_echo")).toBeUndefined()
    expect(surface.route("b2", "mail_send")).toBeUndefined()
    expect(surface.route("b1", "connector_pending_cancel")).toEqual({ kind: "pending-cancel" })
    const send = surface.tools("b1").find((tool) => tool.name === "mail_send")
    expect(send?.description).toMatch(/Asks the user first/)
    expect(send?.sessions).toBe("main")
    expect(send?.parameters).toMatchObject({ type: "object", required: ["to", "body"] })
  })
})
