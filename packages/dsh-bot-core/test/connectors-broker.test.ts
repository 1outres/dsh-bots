import { describe, expect, it } from "vitest"
import type { ConnectorAction } from "../src/shared/connectors"
import { brokerSetup, call, settle } from "./connectors-support"

const web = { kind: "web" } as const

async function ready(options: Parameters<typeof brokerSetup>[0] = {}) {
  const setup = brokerSetup(options)
  setup.catalog.register(setup.connector)
  await setup.enable(setup.connector)
  return setup
}

const signal = () => new AbortController().signal

describe("connector broker: allow and disallow", () => {
  it("runs an allow tool at once without an action", async () => {
    const { broker, log, ledger } = await ready()
    const reply = await broker.call(call("echo", { text: "hi" }), signal())
    expect(reply.data).toEqual({ status: "done", result: { echoed: "hi" } })
    expect(log).toEqual(["echo hi"])
    expect(ledger.all()).toEqual([])
  })

  it("refuses a disallowed, unknown or invalid call before anything runs", async () => {
    const { broker, log, permissions } = await ready()
    await expect(broker.call(call("hidden", {}), signal())).rejects.toThrow(/not available/)
    await expect(broker.call(call("nope", {}), signal())).rejects.toThrow(/no tool "nope"/)
    await expect(broker.call(call("echo", {}), signal())).rejects.toThrow(/invalid arguments/)
    await permissions.set("b1", { connectorId: "mail", tool: "echo", permission: "disallow" })
    await expect(broker.call(call("echo", { text: "x" }), signal())).rejects.toThrow(
      /not available/,
    )
    expect(log).toEqual([])
  })

  it("asks first when the bot overrides an allow tool with ask", async () => {
    const { broker, permissions, clock, log } = await ready()
    await permissions.set("b1", { connectorId: "mail", tool: "echo", permission: "ask" })
    const pending = broker.call(call("echo", { text: "x" }), signal())
    // A tool without ask timing waits DEFAULT_ASK_WAIT_MS.
    await clock.advance(59_999)
    expect(log).toEqual([])
    await clock.advance(1)
    expect((await pending).data).toMatchObject({ status: "awaiting-approval", actionId: "act-1" })
    expect(log).toEqual([])
  })
})

describe("connector broker: ask", () => {
  it("runs an action approved within the wait and returns its result to the call", async () => {
    const { broker, log, notices, ledger } = await ready()
    const pending = broker.call(call("send", { to: "a@x", body: "hello" }), signal())
    await settle()
    const [action] = ledger.list("b1")
    expect(action?.preview).toEqual({
      title: "Send this email?",
      fields: [{ label: "To", value: "a@x" }],
      body: "hello",
    })
    const answer = await broker.recordDecision({
      botId: "b1",
      actionId: "act-1",
      decision: "approve",
      origin: web,
    })
    expect(answer.ok).toBe(true)
    const reply = await pending
    expect(reply.data).toEqual({ actionId: "act-1", state: "succeeded", result: { sent: true } })
    expect(log).toEqual(["send a@x approval"])
    expect(notices).toEqual([])
  })

  it("releases the call when the wait ends and notifies the result of a later approval", async () => {
    const { broker, log, notices, clock } = await ready()
    const pending = broker.call(call("send", { to: "a@x", body: "hello" }), signal())
    await clock.advance(1_000)
    const reply = await pending
    expect(reply.data).toMatchObject({ status: "awaiting-approval", actionId: "act-1" })
    expect(reply.text).toMatch(/Do not call the tool again/)
    expect(log).toEqual([])
    await clock.advance(3_000)
    await broker.recordDecision({
      botId: "b1",
      actionId: "act-1",
      decision: "approve",
      origin: web,
    })
    await settle()
    expect(log).toEqual(["send a@x approval"])
    expect(notices).toHaveLength(1)
    expect(notices[0]?.botId).toBe("b1")
    expect(notices[0]?.notice.text).toMatch(/^\[BOT CONNECTOR NOTICE\]/)
    expect(notices[0]?.notice.text).toContain('"sent": true')
  })

  it("notifies a rejection after the call returned, and answers one within the wait", async () => {
    const { broker, notices, clock, log } = await ready()
    const first = broker.call(call("send", { to: "a@x", body: "1" }), signal())
    await clock.advance(1_000)
    await first
    await broker.recordDecision({ botId: "b1", actionId: "act-1", decision: "reject", origin: web })
    await settle()
    expect(notices.map((entry) => entry.notice.summary)).toEqual([
      "mail_send rejected: Send this email?",
    ])
    const second = broker.call(call("send", { to: "b@x", body: "2" }), signal())
    await settle()
    await broker.recordDecision({ botId: "b1", actionId: "act-2", decision: "reject", origin: web })
    expect((await second).data).toEqual({ actionId: "act-2", state: "rejected" })
    expect(notices).toHaveLength(1)
    expect(log).toEqual([])
  })

  it("expires a pending action at its TTL and notifies it", async () => {
    const { broker, notices, clock, ledger } = await ready()
    const pending = broker.call(call("send", { to: "a@x", body: "1" }), signal())
    await clock.advance(1_000)
    await pending
    await clock.advance(9_000)
    expect(ledger.get("act-1")?.status.state).toBe("expired")
    expect(notices.map((entry) => entry.notice.summary)).toEqual([
      "mail_send expired: Send this email?",
    ])
    const late = await broker.recordDecision({
      botId: "b1",
      actionId: "act-1",
      decision: "approve",
      origin: web,
    })
    expect(late).toMatchObject({ ok: false, code: "settled", state: "expired" })
  })

  it("returns the pending action of an equal call instead of a second one", async () => {
    const { broker, clock, ledger } = await ready()
    const first = broker.call(call("send", { to: "a@x", body: "1" }), signal())
    await clock.advance(1_000)
    await first
    const again = broker.call({ ...call("send", { body: "1", to: "a@x" }) }, signal())
    await clock.advance(1_000)
    expect((await again).data).toMatchObject({ actionId: "act-1" })
    expect(ledger.list("b1")).toHaveLength(1)
  })

  it("publishes an approval before the execution it starts", async () => {
    const { broker, clock, ledger } = await ready()
    const states: string[] = []
    ledger.subscribe(({ action }) => states.push(action.status.state))
    const pending = broker.call(call("send", { to: "a@x", body: "1" }), signal())
    await clock.advance(1_000)
    await pending
    await broker.recordDecision({
      botId: "b1",
      actionId: "act-1",
      decision: "approve",
      origin: web,
    })
    await settle()
    expect(states).toEqual(["pending", "approved", "executing", "succeeded"])
  })

  it("runs an action approved twice at once exactly once", async () => {
    const { broker, clock, log } = await ready()
    const pending = broker.call(call("send", { to: "a@x", body: "1" }), signal())
    await clock.advance(1_000)
    await pending
    const decide = () =>
      broker.recordDecision({ botId: "b1", actionId: "act-1", decision: "approve", origin: web })
    const [one, two] = await Promise.all([decide(), decide()])
    await settle()
    expect([one.ok, two.ok]).toEqual([true, false])
    expect(two).toMatchObject({ ok: false, code: "settled" })
    expect(log).toEqual(["send a@x approval"])
  })

  it("keeps the action when the turn is aborted and notifies its later outcome", async () => {
    const { broker, notices, ledger } = await ready()
    const controller = new AbortController()
    const pending = broker.call(call("send", { to: "a@x", body: "1" }), controller.signal)
    await settle()
    controller.abort()
    expect((await pending).data).toMatchObject({ status: "awaiting-approval" })
    expect(ledger.get("act-1")?.status.state).toBe("pending")
    await broker.recordDecision({
      botId: "b1",
      actionId: "act-1",
      decision: "approve",
      origin: web,
    })
    await settle()
    expect(notices).toHaveLength(1)
  })

  it("lets the bot cancel a pending action, without a notice", async () => {
    const { broker, clock, notices } = await ready()
    const pending = broker.call(call("send", { to: "a@x", body: "1" }), signal())
    await clock.advance(1_000)
    await pending
    expect(broker.pending("b1").data).toMatchObject({
      actions: [{ actionId: "act-1", state: "pending" }],
    })
    expect((await broker.cancel("b1", "act-1")).data).toEqual({
      actionId: "act-1",
      state: "cancelled",
    })
    await expect(broker.cancel("b1", "act-1")).rejects.toThrow(/cannot be cancelled/)
    await expect(broker.cancel("b2", "act-1")).rejects.toThrow(/no connector action/)
    expect(broker.pending("b1").data).toEqual({ actions: [] })
    expect(notices).toEqual([])
  })

  it("does not take another bot's decision", async () => {
    const { broker, clock } = await ready()
    const pending = broker.call(call("send", { to: "a@x", body: "1" }), signal())
    await clock.advance(1_000)
    await pending
    expect(
      await broker.recordDecision({
        botId: "b2",
        actionId: "act-1",
        decision: "approve",
        origin: web,
      }),
    ).toEqual({ ok: false, code: "not-found" })
  })

  it("fails an approved action whose recheck refuses it", async () => {
    const { broker, clock, ledger, log, notices } = await ready({
      recheck: "the thread was deleted",
    })
    const pending = broker.call(call("send", { to: "a@x", body: "1" }), signal())
    await clock.advance(1_000)
    await pending
    await broker.recordDecision({
      botId: "b1",
      actionId: "act-1",
      decision: "approve",
      origin: web,
    })
    await settle()
    expect(ledger.get("act-1")?.status).toMatchObject({
      state: "failed",
      reason: "the thread was deleted",
    })
    expect(log).toEqual([])
    expect(notices[0]?.notice.text).toContain("the thread was deleted")
  })

  it("fails an approved action whose tool became disallowed", async () => {
    const { broker, clock, ledger, permissions, log } = await ready()
    const pending = broker.call(call("send", { to: "a@x", body: "1" }), signal())
    await clock.advance(1_000)
    await pending
    await permissions.set("b1", { connectorId: "mail", tool: "send", permission: "disallow" })
    await broker.recordDecision({
      botId: "b1",
      actionId: "act-1",
      decision: "approve",
      origin: web,
    })
    await settle()
    expect(ledger.get("act-1")?.status).toMatchObject({ state: "failed" })
    expect(log).toEqual([])
  })
})

describe("connector broker: start-up", () => {
  const base: Omit<ConnectorAction, "id" | "status"> = {
    botId: "b1",
    connectorId: "mail",
    tool: "send",
    args: { to: "a@x", body: "1" },
    preview: { title: "Send this email?", fields: [] },
    sessionId: "main-1",
    createdAt: 999_000,
    expiresAt: 1_005_000,
  }
  const decision = { decision: "approve", origin: web, at: 999_500 } as const
  const stored = new Map<string, ConnectorAction>([
    ["run", { ...base, id: "run", status: { state: "executing", decision, startedAt: 999_600 } }],
    [
      "ok",
      {
        ...base,
        id: "ok",
        args: { to: "b@x", body: "2" },
        status: { state: "approved", decision },
      },
    ],
    ["old", { ...base, id: "old", expiresAt: 999_900, status: { state: "pending" } }],
    ["new", { ...base, id: "new", status: { state: "pending" } }],
  ])

  it("interrupts a running action, never runs it again, and runs an approved one once its connector is back", async () => {
    const setup = brokerSetup({ actions: stored })
    await setup.broker.recover()
    await settle()
    const state = (id: string) => setup.ledger.get(id)?.status.state
    expect(state("run")).toBe("interrupted")
    expect(state("old")).toBe("expired")
    expect(state("new")).toBe("pending")
    expect(state("ok")).toBe("approved")
    expect(setup.notices.map((entry) => entry.notice.summary)).toEqual([
      "mail_send interrupted: Send this email?",
      "mail_send expired: Send this email?",
    ])
    setup.catalog.register(setup.connector)
    await settle()
    expect(state("ok")).toBe("approved")
    await setup.enable(setup.connector)
    await settle()
    expect(state("ok")).toBe("succeeded")
    expect(setup.log).toEqual(["send b@x approval"])
    expect(setup.actions.rows.get("run")?.status.state).toBe("interrupted")
  })

  it("fails an approved action whose connector does not come back before it expires", async () => {
    const setup = brokerSetup({ actions: stored })
    await setup.broker.recover()
    await setup.clock.advance(5_000)
    expect(setup.ledger.get("ok")?.status).toMatchObject({ state: "failed" })
    expect(setup.ledger.get("new")?.status.state).toBe("expired")
  })
})
