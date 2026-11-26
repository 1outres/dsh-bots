import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ActionCard, ActionDetails } from "../src/client/approvals/ActionCard"
import { ActionsPanel } from "../src/client/approvals/ActionsPanel"
import type { DecisionOutcome } from "../src/client/approvals/actions-model"
import type { ActionsFeed } from "../src/client/approvals/hub"
import { actionsViewOf, deciderOf, foldBody } from "../src/client/approvals/view"
import type { ConnectorsFeed } from "../src/client/connectors-hub"
import { checkChannelCapabilities } from "../src/host/channels/capabilities"
import { ownersOf } from "../src/host/channels/owners"
import { createConnectorApprovals } from "../src/host/connectors/approvals"
import { checkChannelDescriptor } from "../src/shared/channels"
import type { ConnectorAction, ConnectorActionView } from "../src/shared/connectors"
import { CAPABILITIES, DECIDING, FIELDS } from "./channels-support"
import { brokerSetup } from "./connectors-support"
import { idlePlaces, t } from "./support/client"

const base = (id: string, botId = "b1"): ConnectorAction => ({
  id,
  botId,
  connectorId: "mail",
  tool: "send",
  args: { to: "x@example.com", body: "hi" },
  preview: {
    title: "Send this email?",
    fields: [{ label: "To", value: "x@example.com" }],
    body: "hi",
  },
  sessionId: "main-1",
  createdAt: 1,
  expiresAt: 10_000_000,
  status: { state: "pending" },
})

function setup(actions: ConnectorAction[] = [base("act-1"), base("act-2"), base("act-3", "b2")]) {
  const connectors = brokerSetup({ actions: new Map(actions.map((action) => [action.id, action])) })
  connectors.catalog.register(connectors.connector)
  const approvals = createConnectorApprovals({
    ledger: connectors.ledger,
    broker: connectors.broker,
    catalog: connectors.catalog,
    exists: (botId) => connectors.bots.has(botId),
  })
  return { ...connectors, approvals }
}

const channel = (approvers: string[], aborted = false) => {
  const controller = new AbortController()
  if (aborted) controller.abort()
  return { id: "chat", name: "Chat", approvers: new Set(approvers), signal: controller.signal }
}

describe("connector approvals: who may decide", () => {
  it("takes a Web UI decision only from the DSH owner, and records it", async () => {
    const { approvals, ledger } = setup()
    expect(await approvals.fromWeb(undefined, "b1", "act-1", "approve")).toEqual({
      accepted: false,
      reason: "not-approver",
    })
    expect(await approvals.fromWeb({ kind: "liveshare" }, "b1", "act-1", "approve")).toEqual({
      accepted: false,
      reason: "not-approver",
    })
    expect(ledger.get("act-1")?.status.state).toBe("pending")
    const accepted = await approvals.fromWeb({ kind: "owner" }, "b1", "act-1", "reject")
    expect(accepted).toMatchObject({
      accepted: true,
      action: { id: "act-1", connector: { id: "mail", name: "Mail" }, toolName: "mail_send" },
    })
    expect(ledger.get("act-1")?.status).toMatchObject({
      state: "rejected",
      decision: { decision: "reject", origin: { kind: "web" } },
    })
    await expect(approvals.fromWeb({ kind: "owner" }, "b1", "act-2", "maybe")).rejects.toThrow(
      "approve or reject",
    )
  })

  it("takes a channel decision only from an approver of an open connection", async () => {
    const { approvals, ledger } = setup()
    expect(await approvals.fromChannel("b1", channel([]), "1", "act-1", "approve")).toEqual({
      accepted: false,
      reason: "not-approver",
    })
    expect(
      await approvals.fromChannel("b1", channel(["1"], true), "1", "act-1", "approve"),
    ).toEqual({
      accepted: false,
      reason: "closed",
    })
    expect(ledger.get("act-1")?.status.state).toBe("pending")
    expect(
      await approvals.fromChannel("b1", channel(["1"]), "1", "act-1", "approve"),
    ).toMatchObject({
      accepted: true,
    })
    expect(ledger.get("act-1")?.status).toMatchObject({
      decision: {
        origin: { kind: "channel", channelId: "chat", channelName: "Chat", person: "1" },
      },
    })
  })

  it("lets the first decision win and shows the later one the action's state", async () => {
    const { approvals } = setup()
    await approvals.fromWeb({ kind: "owner" }, "b1", "act-1", "reject")
    expect(
      await approvals.fromChannel("b1", channel(["1"]), "1", "act-1", "approve"),
    ).toMatchObject({
      accepted: false,
      reason: "settled",
      action: { status: { state: "rejected" } },
    })
    expect(await approvals.fromWeb({ kind: "owner" }, "b2", "act-1", "approve")).toEqual({
      accepted: false,
      reason: "not-found",
    })
  })

  it("finds only the bot's own actions, and lists its pending ones oldest first", async () => {
    const { approvals } = setup([
      { ...base("act-2"), createdAt: 5 },
      base("act-1"),
      { ...base("act-4"), status: { state: "expired", finishedAt: 3 } },
      base("act-3", "b2"),
    ])
    expect(approvals.find("b1", "act-1")).toMatchObject({ id: "act-1", toolName: "mail_send" })
    expect(approvals.find("b1", "act-3")).toBeUndefined()
    const listed = approvals.pendingFor("b1", channel(["1"]), "1")
    expect(listed.ok && listed.actions.map((action) => action.id)).toEqual(["act-1", "act-2"])
  })

  it("lists a bot's actions, its open ones, and pending ones per bot", async () => {
    const { approvals } = setup()
    expect(approvals.waiting()).toEqual({ b1: 2, b2: 1 })
    await approvals.fromWeb({ kind: "owner" }, "b1", "act-1", "reject")
    expect(approvals.waiting()).toEqual({ b1: 1, b2: 1 })
    expect(approvals.views("b1").map((view) => view.id)).toEqual(["act-1", "act-2"])
    expect(approvals.open("b1").map((view) => view.id)).toEqual(["act-2"])
    expect(() => approvals.views("zz")).toThrow("does not exist")
    const seen: string[] = []
    const off = approvals.subscribe((view) => seen.push(`${view.id} ${view.status.state}`))
    await approvals.fromWeb({ kind: "owner" }, "b1", "act-2", "reject")
    off()
    expect(seen).toEqual(["act-2 rejected"])
  })
})

describe("channel owners and the connector action capability", () => {
  it("owners must name a list field, and the owners come from the settings", () => {
    const chat = { id: "chat", name: "Chat", fields: FIELDS }
    expect(() => checkChannelDescriptor({ ...chat, owners: "users" })).not.toThrow()
    expect(() => checkChannelDescriptor({ ...chat, owners: "server" })).toThrow("list fields")
    expect(() => checkChannelDescriptor({ ...chat, owners: "nope" })).toThrow("list fields")
    expect([...ownersOf({ owners: "users" }, { users: ["1", "2"] })]).toEqual(["1", "2"])
    expect([...ownersOf({}, { users: ["1"] })]).toEqual([])
  })

  it("deciding connector actions needs an owners field", () => {
    expect(() => checkChannelCapabilities({ id: "chat", owners: "users" }, DECIDING)).not.toThrow()
    expect(() => checkChannelCapabilities({ id: "chat" }, DECIDING)).toThrow("owners field")
    expect(() =>
      checkChannelCapabilities(
        { id: "chat", owners: "users" },
        { ...CAPABILITIES, connectorActions: { approvers: "users" } },
      ),
    ).toThrow("true or absent")
  })
})

const view = (id: string, status: ConnectorActionView["status"]): ConnectorActionView => ({
  id,
  botId: "b1",
  connector: { id: "mail", name: "Mail" },
  tool: "send",
  toolName: "mail_send",
  args: { to: "x" },
  preview: {
    title: `Send ${id}?`,
    fields: [{ label: "To", value: "<b>x</b>" }],
    body: "<script>alert(1)</script>",
  },
  createdAt: 1,
  expiresAt: 3_600_000,
  status,
})
const unreachable = async (): Promise<DecisionOutcome> => ({ kind: "unreachable", message: "x" })
const decided = { decision: "approve", origin: { kind: "web" }, at: 5 } as const

describe("actions panel", () => {
  it("puts open actions first, oldest first, then every ended one, newest first", () => {
    const actions = [
      view("a", { state: "pending" }),
      view("b", { state: "rejected", decision: { ...decided, decision: "reject" } }),
      view("c", { state: "expired", finishedAt: 9 }),
      view("d", { state: "executing", decision: decided, startedAt: 6 }),
    ]
    const actionsView = actionsViewOf(actions)
    expect(actionsView.open.map((action) => action.id)).toEqual(["a", "d"])
    expect(actionsView.history.map((action) => action.id)).toEqual(["c", "b"])
    expect(actionsView.pending).toBe(1)
  })

  it("words who decided in a channel only, and a folded body", () => {
    expect(deciderOf(decided)).toBeUndefined()
    expect(
      deciderOf({
        decision: "reject",
        origin: { kind: "channel", channelId: "discord", channelName: "Discord", person: "42" },
        at: 1,
      }),
    ).toEqual({ key: "approvals.by.channel.reject", params: { channel: "Discord", person: "42" } })
    expect(foldBody("short")).toBeUndefined()
    expect(foldBody("x\n".repeat(30))?.split("\n")).toHaveLength(12)
  })

  it("shows a preview's untrusted text as text, never as markup", () => {
    const html = renderToStaticMarkup(
      createElement(ActionCard, {
        t,
        action: view("a", { state: "pending" }),
        now: 0,
        decide: unreachable,
      }),
    )
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;")
    expect(html).toContain('data-dshb-action-decide="reject"')
    expect(html).toContain('data-dshb-action-decide="approve"')
    expect(html).toContain('data-dshb-action-expiry=""')
    expect(html).toContain("Mail · mail_send · ")
  })

  it("shows a running action without buttons or expiry", () => {
    const html = renderToStaticMarkup(
      createElement(ActionCard, {
        t,
        action: view("a", { state: "executing", decision: decided, startedAt: 6 }),
        now: 0,
        decide: unreachable,
      }),
    )
    expect(html).toContain("approvals.state.executing")
    expect(html).toContain('data-tone="busy"')
    expect(html).not.toContain('data-dshb-action-decide="')
    expect(html).not.toContain("data-dshb-action-expiry")
  })

  it("details how an ended action went: the result, a channel's decider and the arguments", () => {
    const html = renderToStaticMarkup(
      createElement(ActionDetails, {
        t,
        action: view("a", {
          state: "succeeded",
          decision: {
            decision: "approve",
            origin: { kind: "channel", channelId: "discord", channelName: "Discord", person: "42" },
            at: 5,
          },
          startedAt: 6,
          finishedAt: 7,
          result: { sent: true },
        }),
      }),
    )
    expect(html).toContain("approvals.by.channel.approve(Discord,42)")
    expect(html).toContain("approvals.result")
    expect(html).toContain("&quot;sent&quot;: true")
    expect(html).toContain("approvals.args")
    expect(html).not.toContain('data-dshb-action-decide="')
  })

  const feedOf = (actions: ConnectorActionView[]): ActionsFeed => ({
    getSnapshot: () => ({ status: "ready", actions, reconnecting: false }),
    subscribe: () => () => {},
    decide: unreachable,
  })
  const connectors: ConnectorsFeed = {
    getSnapshot: () => ({ status: "loading" }),
    subscribe: () => () => {},
    configure: () => Promise.reject(new Error("idle")),
    setPermission: () => Promise.reject(new Error("idle")),
    retry: () => Promise.reject(new Error("idle")),
  }
  const panel = (feed: ActionsFeed) =>
    renderToStaticMarkup(
      createElement(ActionsPanel, {
        t,
        text: (value) => value.en,
        sessionId: "m1",
        feed,
        connectors,
        places: idlePlaces,
        width: { getSnapshot: () => 420, subscribe: () => () => {}, resize: () => {} },
        containerRef: { current: null },
        close: () => {},
      }),
    )

  it("says there is nothing yet while a bot has no action", () => {
    const html = panel(feedOf([]))
    expect(html).toContain('data-dshb-actions=""')
    expect(html).toContain('data-dshb-actions-empty=""')
    expect(html).toContain("approvals.empty")
  })

  it("lists the open actions as cards and the ended ones as History rows", () => {
    const html = panel(
      feedOf([view("a", { state: "pending" }), view("c", { state: "expired", finishedAt: 9 })]),
    )
    expect(html).toContain('<article class="dshb-action" data-state="pending" data-dshb-action="a"')
    expect(html).toContain('data-dshb-actions-history=""')
    expect(html).toContain("approvals.history")
    expect(html).toMatch(
      /data-dshb-action="c"[\s\S]*aria-expanded="false"[\s\S]*approvals\.state\.expired/,
    )
    expect(html).not.toContain("data-dshb-action-details")
  })
})
