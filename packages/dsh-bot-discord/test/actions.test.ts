import type { ConnectorActionStatus, ConnectorActionView } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import {
  decodeActionCustomId,
  encodeActionCustomId,
  isActionCustomId,
} from "../src/host/actions/custom-id"
import { createActionPresenter } from "../src/host/actions/presenter"
import { openApprovalRecords } from "../src/host/actions/records"
import { codeBlock, literal, renderActionCard } from "../src/host/actions/render"
import { createDiscordBridge } from "../src/host/bridge"
import type { DiscordSessionEvents } from "../src/host/connection"
import type {
  DiscordActions,
  DiscordButton,
  DiscordCommandResponse,
  DiscordComponentPress,
  DiscordMessageEdit,
} from "../src/host/discord"
import { createSerialQueue } from "../src/host/queue"
import {
  ALLOWED,
  fakeActions,
  fakeLink,
  manualClock,
  memoryApprovalTables,
  OTHER,
  settle,
} from "./support"

const decision = (person = ALLOWED) =>
  ({
    decision: "approve",
    origin: { kind: "channel", channelId: "discord", channelName: "Discord", person },
    at: 1_700_000_100_000,
  }) as const

function action(
  status: ConnectorActionStatus = { state: "pending" },
  body = "Hello **there**",
): ConnectorActionView {
  return {
    id: "act-1a2b3c",
    botId: "b1",
    connector: { id: "mail", name: "Mail" },
    tool: "send",
    toolName: "mail_send",
    args: { to: "x@example.com", body },
    preview: {
      title: "Send this email?",
      fields: [{ label: "To", value: "@everyone <x@example.com>" }],
      body,
    },
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_003_600_000,
    status,
  }
}

const buttons = (card: DiscordMessageEdit) =>
  card.components.flat().filter((c): c is DiscordButton => c.kind === "button")

function press(overrides: Partial<DiscordComponentPress> = {}) {
  const updates: DiscordMessageEdit[] = []
  const replies: DiscordCommandResponse[] = []
  const value: DiscordComponentPress = {
    customId: encodeActionCustomId("act-1a2b3c", "approve"),
    userId: ALLOWED,
    guildId: null,
    locale: "en-US",
    channelId: `dm-${ALLOWED}`,
    messageId: "old-1",
    values: [],
    async update(message) {
      updates.push(message)
    },
    async reply(response) {
      replies.push(response)
    },
    async showModal() {},
    ...overrides,
  }
  return { value, updates, replies }
}

function setup(
  approvers = [ALLOWED],
  options: {
    tables?: ReturnType<typeof memoryApprovalTables>
    actions?: Partial<DiscordActions>
  } = {},
) {
  const link = fakeLink({ token: "t", users: [ALLOWED], approvers, language: "" })
  const { actions, calls } = fakeActions(options.actions)
  const tables = options.tables ?? memoryApprovalTables()
  const warnings: string[] = []
  const presenter = createActionPresenter({
    link: link.link,
    actions,
    records: openApprovalRecords(tables, "b1"),
    approvers,
    recipients: async () => approvers.map((userId) => ({ userId, channelId: `dm-${userId}` })),
    locale: "en",
    self: "discord",
    outbound: createSerialQueue(),
    closed: () => false,
    warn: (message) => warnings.push(message),
  })
  /** bot-core's ledger changed and sent the channel the action's view. */
  const emit = (view: ConnectorActionView) => {
    link.keep(view)
    return presenter.received(view)
  }
  return { link, calls, presenter, tables, warnings, emit }
}

/** Sends and edits of cards: the lists carry no content. */
const cardCalls = (calls: readonly string[]) =>
  calls.filter((call) => /^(send \S+|edit \S+ \S+) \S/.test(call))

describe("connector action custom ids", () => {
  it("round-trip both decisions and refuse anything else", () => {
    for (const choice of ["approve", "reject"] as const) {
      const id = encodeActionCustomId("act-1a2b3c", choice)
      expect(isActionCustomId(id)).toBe(true)
      expect(decodeActionCustomId(id)).toEqual({ actionId: "act-1a2b3c", decision: choice })
    }
    expect(isActionCustomId("dshb:q1:u")).toBe(false)
    expect(decodeActionCustomId("dshc:act-1:x")).toBeUndefined()
    expect(decodeActionCustomId("dshc:a b:a")).toBeUndefined()
    expect(() => encodeActionCustomId("a:b", "approve")).toThrow()
  })
})

describe("connector action cards", () => {
  it("show the preview as typed, with Approve and Reject while pending", () => {
    const card = renderActionCard(action(), "discord", "en")
    expect(card.content).toBe("⏳ Waiting for your decision; it expires <t:1700003600:R>.")
    const description = card.embeds?.[0]?.description ?? ""
    expect(card.embeds?.[0]?.title).toBe("🔐 Send this email?")
    expect(description).toContain("**To**: \\@everyone \\<x\\@example.com\\>")
    expect(description).toContain(codeBlock("Hello **there**"))
    expect(description).toContain("<t:1700000000:f>")
    expect(buttons(card).map((button) => [button.label, button.style])).toEqual([
      ["Approve", "success"],
      ["Reject", "danger"],
    ])
  })

  it("show every field of an account's email in full: the account first, addresses, threading and attachment hashes", () => {
    const sha = "a".repeat(64)
    const fields = [
      { label: "Account", value: "Work <alice@example.com>" },
      { label: "From", value: "alice@example.com" },
      { label: "To", value: "Bob Example <bob@example.com>, carol@example.org" },
      { label: "Cc", value: "山田 太郎 <taro@example.jp>" },
      { label: "Bcc", value: "audit@example.com" },
      { label: "Subject", value: "Re: 四半期レポート" },
      { label: "In reply to", value: "<in1@sender.example>" },
      { label: "Attachment 1", value: `report.pdf (application/pdf, 1.2 MiB, sha256 ${sha})` },
    ]
    const view: ConnectorActionView = {
      ...action(),
      connector: { id: "gmail", name: "Gmail" },
      tool: "reply",
      toolName: "gmail_reply",
      preview: {
        title: "Send this reply?",
        fields,
        body: "はい、金曜で大丈夫です。\n\n> Are you free?",
      },
    }
    const description = renderActionCard(view, "discord", "ja").embeds?.[0]?.description ?? ""
    const lines = description.split("\n\n")
    expect(lines[0]).toBe("-# Gmail · `gmail_reply`")
    expect(lines.slice(1, 1 + fields.length)).toEqual(
      fields.map((field) => `**${literal(field.label)}**: ${literal(field.value)}`),
    )
    expect(description).toContain(codeBlock("はい、金曜で大丈夫です。\n\n> Are you free?"))
    expect(description).not.toContain("…")
  })

  it("keep a fence in the body from closing its block", () => {
    expect(codeBlock("a```b")).toBe("```text\na`\u200b``b\n```")
    expect(literal("[x](https://e)")).toBe("\\[x\\]\\(https\\://e\\)")
  })

  it("cut a long body within Discord's limit and point to the Web UI", () => {
    const card = renderActionCard(action({ state: "pending" }, "x".repeat(10_000)), "discord", "ja")
    const description = card.embeds?.[0]?.description ?? ""
    expect(description.length).toBeLessThanOrEqual(4096)
    expect(description).toContain("全文は Web UI のボットの画面で確認できます")
  })

  it("say who decided where and how it ended, without buttons", () => {
    const done = renderActionCard(
      action({
        state: "succeeded",
        decision: decision(),
        startedAt: 1,
        finishedAt: 2,
        result: { sent: true },
      }),
      "discord",
      "en",
    )
    expect(done.content).toContain(`✅ Done (approved by <@${ALLOWED}> in Discord).`)
    expect(done.content).toContain('{"sent":true}')
    expect(done.components).toEqual([])
    const web = renderActionCard(
      action({
        state: "rejected",
        decision: { ...decision(), decision: "reject", origin: { kind: "web" } },
      }),
      "discord",
      "ja",
    )
    expect(web.content).toBe("🚫 Web UI で拒否されました。実行していません。")
    expect(
      renderActionCard(action({ state: "expired", finishedAt: 3 }), "discord", "en").content,
    ).toBe("⌛ Expired without a decision; it was not run.")
  })
})

describe("connector action presenter", () => {
  it("posts a pending action to every approver's DM and follows it until it ends", async () => {
    const { calls, emit, tables } = setup([ALLOWED, OTHER])
    await emit(action())
    expect(calls.filter((call) => call.startsWith("send") && call.includes("⏳"))).toEqual([
      `send dm-${ALLOWED} ⏳ Waiting for your decision; it expires <t:1700003600:R>.`,
      `send dm-${OTHER} ⏳ Waiting for your decision; it expires <t:1700003600:R>.`,
    ])
    expect(tables.cards.map.size).toBe(2)
    await emit(action({ state: "executing", decision: decision(), startedAt: 5 }))
    await emit(action({ state: "cancelled", finishedAt: 6 }))
    await emit(action({ state: "cancelled", finishedAt: 6 }))
    const edits = cardCalls(calls).filter((call) => call.startsWith("edit"))
    expect(edits).toHaveLength(4)
    expect(edits.at(-1)).toContain("↩️ The bot cancelled it")
    expect(tables.cards.map.size).toBe(0)
  })

  it("posts no card for an action that is not pending, or no longer pending now", async () => {
    const { calls, emit, link, presenter } = setup()
    await emit(action({ state: "expired", finishedAt: 1 }))
    await emit(action({ state: "approved", decision: decision() }))
    link.keep(action({ state: "rejected", decision: decision() }))
    await presenter.received(action())
    expect(calls.filter((call) => call.includes("⏳"))).toEqual([])
  })

  it("edits the cards an earlier connection posted instead of posting them again", async () => {
    const tables = memoryApprovalTables()
    const first = setup([ALLOWED], { tables })
    await first.emit(action())
    const posted = [...tables.cards.map.values()]
    const second = setup([ALLOWED], { tables })
    second.link.keep(action())
    await second.presenter.start()
    await second.presenter.received(action())
    expect(second.calls.filter((call) => call.includes("⏳"))).toEqual([
      `edit dm-${ALLOWED} ${posted[0]?.messageId} ⏳ Waiting for your decision; it expires <t:1700003600:R>.`,
    ])
    expect([...tables.cards.map.values()]).toEqual(posted)
  })

  it("brings up to date the cards of actions that ended or were dropped while it was away", async () => {
    const tables = memoryApprovalTables()
    const first = setup([ALLOWED], { tables })
    await first.emit(action())
    await first.emit({ ...action(), id: "act-2" })
    const second = setup([ALLOWED], { tables })
    second.link.keep(action({ state: "expired", finishedAt: 9 }))
    await second.presenter.start()
    const edits = second.calls.filter((call) => call.startsWith("edit"))
    expect(edits.some((call) => call.includes("⌛ Expired"))).toBe(true)
    expect(edits.some((call) => call.includes("no longer kept"))).toBe(true)
    expect(tables.cards.map.size).toBe(0)
  })

  it("posts a pending action's card again when it was deleted in Discord", async () => {
    const tables = memoryApprovalTables()
    const first = setup([ALLOWED], { tables })
    await first.emit(action())
    const second = setup([ALLOWED], {
      tables,
      actions: {
        async edit() {
          return "missing"
        },
      },
    })
    await second.emit(action())
    expect(second.calls.filter((call) => call.includes("⏳"))).toEqual([
      `send dm-${ALLOWED} ⏳ Waiting for your decision; it expires <t:1700003600:R>.`,
    ])
  })

  it("withdraws the cards and removes the list of someone who is no longer an approver", async () => {
    const tables = memoryApprovalTables()
    const first = setup([ALLOWED, OTHER], { tables })
    await first.emit(action())
    const second = setup([ALLOWED], { tables })
    second.link.keep(action())
    await second.presenter.start()
    expect(second.calls).toContainEqual(
      expect.stringMatching(new RegExp(`^edit dm-${OTHER} \\S+ This card was withdrawn`)),
    )
    expect(second.calls).toContainEqual(expect.stringMatching(new RegExp(`^remove dm-${OTHER} `)))
    const owners = (map: Map<string, { userId: string }>) => [
      ...new Set([...map.values()].map((record) => record.userId)),
    ]
    expect(owners(tables.cards.map)).toEqual([ALLOWED])
    expect(owners(tables.digests.map)).toEqual([ALLOWED])
  })

  it("forgets cards and lists in a DM this bot can no longer reach (a new token)", async () => {
    const tables = memoryApprovalTables()
    await tables.cards.put(`b1:act-1a2b3c:${ALLOWED}`, {
      botId: "b1",
      actionId: "act-1a2b3c",
      userId: ALLOWED,
      channelId: "dm-old",
      messageId: "m-old",
    })
    const { presenter, link, calls } = setup([ALLOWED], { tables })
    link.keep(action())
    await presenter.start()
    await presenter.received(action())
    expect(calls.some((call) => call.includes("m-old"))).toBe(false)
    expect([...tables.cards.map.values()].map((card) => card.channelId)).toEqual([`dm-${ALLOWED}`])
  })

  it("takes a decision through the link and shows the action as it now stands", async () => {
    const { link, presenter, tables } = setup()
    link.decideWith(() => ({
      accepted: true,
      action: action({ state: "approved", decision: decision() }),
    }))
    const pressed = press()
    await presenter.press(pressed.value)
    expect(link.decisions).toEqual([
      { actionId: "act-1a2b3c", decision: "approve", person: ALLOWED },
    ])
    expect(pressed.updates[0]?.content).toContain("✅ Approved by")
    expect(pressed.updates[0]?.components).toEqual([])
    expect([...tables.cards.map.values()].map((card) => card.messageId)).toEqual(["old-1"])
  })

  it("tells only the person who may not decide, and leaves the card as it is", async () => {
    const { link, presenter } = setup()
    link.decideWith(() => ({ accepted: false, reason: "not-approver" }))
    const pressed = press({ userId: OTHER, locale: "ja" })
    await presenter.press(pressed.value)
    expect(pressed.updates).toEqual([])
    expect(pressed.replies).toEqual([
      {
        content: expect.stringContaining("判断できるのはオーナーだけです") as unknown as string,
        ephemeral: true,
      },
    ])
  })

  it("answers an old card with the settled action, or that it is gone", async () => {
    const { link, presenter } = setup()
    link.decideWith(() => ({
      accepted: false,
      reason: "settled",
      action: action({ state: "expired", finishedAt: 9 }),
    }))
    const settled = press()
    await presenter.press(settled.value)
    expect(settled.updates[0]?.content).toContain("⌛ Expired")
    link.decideWith(() => ({ accepted: false, reason: "not-found" }))
    const gone = press()
    await presenter.press(gone.value)
    expect(gone.updates[0]).toEqual({
      content: expect.stringContaining("no longer kept") as unknown as string,
      components: [],
    })
  })

  it("refuses a press outside the DMs without deciding", async () => {
    const { link, presenter } = setup()
    const pressed = press({ guildId: "g1" })
    await presenter.press(pressed.value)
    expect(link.decisions).toEqual([])
    expect(pressed.replies[0]?.ephemeral).toBe(true)
  })
})

describe("Discord bridge: connector actions", () => {
  it("routes action outputs to the approvers' DMs and their buttons to the link", async () => {
    const clock = manualClock()
    const link = fakeLink({ token: "t", users: [ALLOWED], approvers: [OTHER], language: "" })
    const { actions, calls } = fakeActions()
    let events: DiscordSessionEvents | undefined
    const bridge = createDiscordBridge({
      link: link.link,
      channelId: "discord",
      connect(supplied) {
        events = supplied
        return { ...actions, async close() {} }
      },
      scheduler: clock.scheduler,
      fetch: async () => ({ ok: false, status: 404, body: (async function* () {})() }),
      records: openApprovalRecords(memoryApprovalTables(), "b1"),
      warn: () => {},
    })
    events?.ready({ id: "self", tag: "bot" })
    link.keep(action())
    await bridge.receive({ kind: "connector-action", action: action() })
    expect(calls.filter((call) => call.startsWith("send") && call.includes("⏳"))).toEqual([
      `send dm-${OTHER} ⏳ Waiting for your decision; it expires <t:1700003600:R>.`,
    ])
    const pressed = press({ userId: OTHER, channelId: `dm-${OTHER}` })
    events?.component(pressed.value)
    await settle()
    expect(link.decisions).toEqual([{ actionId: "act-1a2b3c", decision: "approve", person: OTHER }])
  })
})
