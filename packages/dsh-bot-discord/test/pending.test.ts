import type { ConnectorActionView } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { digestEmbed, messageUrl } from "../src/host/actions/digest"
import { createActionPresenter } from "../src/host/actions/presenter"
import { openApprovalRecords, purgeApprovalRecords } from "../src/host/actions/records"
import { createDiscordBridge } from "../src/host/bridge"
import type { DiscordSessionEvents } from "../src/host/connection"
import type {
  DiscordActions,
  DiscordCommandResponse,
  DiscordOutgoingMessage,
  DiscordPinOutcome,
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

const pending = (
  id: string,
  overrides: Partial<ConnectorActionView> = {},
): ConnectorActionView => ({
  id,
  botId: "b1",
  connector: { id: "mail", name: "Mail" },
  tool: "send",
  toolName: "mail_send",
  args: {},
  preview: { title: `Send [mail] ${id}?`, fields: [] },
  createdAt: 1_700_000_000_000,
  expiresAt: 1_700_003_600_000,
  status: { state: "pending" },
  ...overrides,
})

describe("pending approvals list", () => {
  it("lists one line per action, linking to its card, in the notice language", () => {
    const card = { channelId: "dm-1", messageId: "m-9" }
    const en = digestEmbed("Aide", [{ action: pending("a1"), card }], "en")
    expect(en.title).toBe("📋 Pending approvals of Aide (1)")
    expect(en.description).toBe(
      [
        `1. [Send \\[mail\\] a1?](${messageUrl(card)}) — Mail · \`mail_send\` · expires <t:1700003600:R>`,
        "-# Oldest first. A title opens its card, with Approve and Reject.",
      ].join("\n"),
    )
    expect(messageUrl(card)).toBe("https://discord.com/channels/@me/dm-1/m-9")
    const ja = digestEmbed("Aide", [{ action: pending("a1"), card: undefined }], "ja")
    expect(ja.title).toBe("📋 Aide の承認待ち（1 件）")
    expect(ja.description).toContain("1. **Send \\[mail\\] a1?** — Mail · `mail_send` · 期限 <t:")
  })

  it("says there is none", () => {
    expect(digestEmbed("Aide", [], "en")).toEqual({
      title: "📋 Pending approvals of Aide (0)",
      description: "No pending approvals.",
    })
    expect(digestEmbed("Aide", [], "ja").description).toBe("承認待ちはありません。")
  })

  it("keeps within Discord's limit, the oldest first, and counts the rest", () => {
    const entries = Array.from({ length: 80 }, (_, index) => ({
      action: pending(`a${index}`, { preview: { title: "x".repeat(300), fields: [] } }),
      card: { channelId: "300000000000000001", messageId: `40000000000000${index}` },
    }))
    const embed = digestEmbed("Aide", entries, "ja")
    const description = embed.description ?? ""
    expect(description.length).toBeLessThanOrEqual(4096)
    expect(embed.title).toBe("📋 Aide の承認待ち（80 件）")
    expect(description.startsWith("1. [")).toBe(true)
    const shown = description.split("\n").filter((line) => /^\d+\. /.test(line)).length
    expect(shown).toBeGreaterThan(5)
    expect(description).toContain(
      `…ほか ${80 - shown} 件（Web UI のボットの画面ですべて確認できます）`,
    )
  })
})

function setup(
  options: {
    approvers?: readonly string[]
    pin?: () => Promise<DiscordPinOutcome>
    tables?: ReturnType<typeof memoryApprovalTables>
    actions?: Partial<DiscordActions>
  } = {},
) {
  const approvers = options.approvers ?? [ALLOWED]
  const link = fakeLink({ token: "t", users: [ALLOWED], approvers, language: "ja" })
  const sent: { channelId: string; message: DiscordOutgoingMessage }[] = []
  const { actions, calls } = fakeActions({
    ...(options.pin === undefined ? {} : { pin: options.pin }),
    ...options.actions,
  })
  const send = actions.send
  actions.send = async (channelId, message) => {
    sent.push({ channelId, message })
    return send(channelId, message)
  }
  const tables = options.tables ?? memoryApprovalTables()
  const warnings: string[] = []
  const presenter = createActionPresenter({
    link: link.link,
    actions,
    records: openApprovalRecords(tables, "b1"),
    approvers,
    recipients: async () => approvers.map((userId) => ({ userId, channelId: `dm-${userId}` })),
    locale: "ja",
    self: "discord",
    outbound: createSerialQueue(),
    closed: () => false,
    warn: (message) => warnings.push(message),
  })
  const emit = (view: ConnectorActionView) => {
    link.keep(view)
    return presenter.received(view)
  }
  const lists = () => sent.filter((entry) => entry.message.content === "")
  return { link, calls, presenter, tables, warnings, emit, lists }
}

describe("pending approvals list in each approver's DM", () => {
  it("posts one list per approver, pins it once, and edits it as actions come and go", async () => {
    const { calls, presenter, emit, lists, tables } = setup({ approvers: [ALLOWED, OTHER] })
    await presenter.start()
    expect(lists().map((entry) => entry.message.embeds?.[0]?.description)).toEqual([
      "承認待ちはありません。",
      "承認待ちはありません。",
    ])
    expect(calls.filter((call) => call.startsWith("pin"))).toHaveLength(2)
    expect([...tables.digests.map.values()].map((digest) => digest.pin)).toEqual([
      "pinned",
      "pinned",
    ])
    await emit(pending("a1"))
    await emit(pending("a1", { status: { state: "expired", finishedAt: 2 } }))
    expect(lists()).toHaveLength(2)
    expect(calls.filter((call) => call.startsWith("pin"))).toHaveLength(2)
    const digestId = [...tables.digests.map.values()][0]?.messageId
    const edits = calls.filter((call) => call === `edit dm-${ALLOWED} ${digestId} `)
    expect(edits).toHaveLength(2)
  })

  it("links each line to the approver's own card", async () => {
    const { presenter, emit, tables } = setup()
    await presenter.start()
    await emit(pending("a1"))
    const card = [...tables.cards.map.values()][0]
    const answer = presenter.pending(ALLOWED, "en-US")
    expect(answer.ephemeral).toBe(true)
    expect(answer.embeds?.[0]?.description).toContain(
      `(https://discord.com/channels/@me/dm-${ALLOWED}/${card?.messageId})`,
    )
  })

  it("keeps the list up to date unpinned when Discord refuses the pin, and tries once", async () => {
    let pins = 0
    const { presenter, emit, warnings, tables, lists } = setup({
      pin: async () => {
        pins += 1
        return "full"
      },
    })
    await presenter.start()
    await emit(pending("a1"))
    expect(pins).toBe(1)
    expect(warnings).toEqual([expect.stringContaining("refused to pin")])
    expect([...tables.digests.map.values()][0]?.pin).toBe("abandoned")
    expect(lists()).toHaveLength(1)
  })

  it("gives the pin up on an unexpected failure too", async () => {
    const { presenter, warnings, tables } = setup({
      pin: async () => {
        throw new Error("network down")
      },
    })
    await presenter.start()
    expect(warnings).toEqual([expect.stringContaining("network down")])
    expect([...tables.digests.map.values()][0]?.pin).toBe("abandoned")
  })

  it("posts and pins the list again when it was deleted in Discord", async () => {
    const tables = memoryApprovalTables()
    await setup({ tables }).presenter.start()
    const second = setup({
      tables,
      actions: {
        async edit() {
          return "missing"
        },
      },
    })
    await second.presenter.start()
    expect(second.lists()).toHaveLength(1)
    expect(second.calls.filter((call) => call.startsWith("pin"))).toHaveLength(1)
    expect(tables.digests.map.size).toBe(1)
  })

  it("edits the same list after a reconnection, and pins a list whose pin was never tried", async () => {
    const tables = memoryApprovalTables()
    await tables.digests.put(`b1:${ALLOWED}`, {
      botId: "b1",
      userId: ALLOWED,
      channelId: `dm-${ALLOWED}`,
      messageId: "m-list",
      pin: "due",
    })
    const { presenter, lists, calls } = setup({ tables })
    await presenter.start()
    expect(lists()).toEqual([])
    expect(calls).toEqual([`edit dm-${ALLOWED} m-list `, `pin dm-${ALLOWED} m-list`])
  })

  it("posts no list when the DM cannot be written, and warns", async () => {
    const { presenter, warnings, tables } = setup({
      actions: {
        async send() {
          throw new Error("Cannot send messages to this user")
        },
      },
    })
    await presenter.start()
    expect(warnings).toEqual([expect.stringContaining("Cannot send messages to this user")])
    expect(tables.digests.map.size).toBe(0)
  })
})

describe("stored approval records", () => {
  it("drop only the records of bots that are gone", async () => {
    const tables = memoryApprovalTables()
    for (const botId of ["kept", "gone"]) {
      const records = openApprovalRecords(tables, botId)
      await records.saveCard({ actionId: "a1", userId: ALLOWED, channelId: "c", messageId: "m" })
      await records.saveDigest({ userId: ALLOWED, channelId: "c", messageId: "d", pin: "pinned" })
    }
    await purgeApprovalRecords(tables, (botId) => botId === "kept")
    expect([...tables.cards.map.keys()]).toEqual([`kept:a1:${ALLOWED}`])
    expect([...tables.digests.map.keys()]).toEqual([`kept:${ALLOWED}`])
    expect(openApprovalRecords(tables, "kept").cards()).toMatchObject([{ botId: "kept" }])
  })
})

describe("/pending", () => {
  function bridge(approvers: readonly string[]) {
    const link = fakeLink({ token: "t", users: [ALLOWED], approvers, language: "" })
    const { actions } = fakeActions()
    let events: DiscordSessionEvents | undefined
    createDiscordBridge({
      link: link.link,
      channelId: "discord",
      connect(supplied) {
        events = supplied
        return { ...actions, async close() {} }
      },
      scheduler: manualClock().scheduler,
      fetch: async () => ({ ok: false, status: 404, body: (async function* () {})() }),
      records: openApprovalRecords(memoryApprovalTables(), "b1"),
      warn: () => {},
    })
    events?.ready({ id: "self", tag: "bot" })
    const ask = async (userId: string, locale = "en-US") => {
      const responses: DiscordCommandResponse[] = []
      events?.command({
        name: "pending",
        userId,
        guildId: null,
        locale,
        async respond(response) {
          responses.push(response)
        },
      })
      await settle()
      return responses
    }
    return { link, ask }
  }

  it("answers an approver privately with the list, even one who does not talk to the bot", async () => {
    const { link, ask } = bridge([OTHER])
    link.keep(pending("a1"))
    const [answer] = await ask(OTHER, "ja")
    expect(answer?.ephemeral).toBe(true)
    expect(answer?.embeds?.[0]?.title).toBe("📋 Bot の承認待ち（1 件）")
    expect(answer?.embeds?.[0]?.description).toContain("Send \\[mail\\] a1?")
    expect(link.commands).toEqual([])
  })

  it("shows nothing of the actions to anyone else", async () => {
    const { link, ask } = bridge([OTHER])
    link.keep(pending("a1"))
    const [answer] = await ask(ALLOWED, "ja")
    expect(answer).toEqual({
      content: expect.stringContaining("承認待ちの操作を見られるのは") as unknown as string,
      ephemeral: true,
    })
    expect(JSON.stringify(answer)).not.toContain("a1")
  })
})
