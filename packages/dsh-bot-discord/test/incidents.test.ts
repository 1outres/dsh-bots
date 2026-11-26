import type { VaultIncidentView } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { openApprovalRecords } from "../src/host/actions/records"
import { createDiscordBridge } from "../src/host/bridge"
import { createDiscordChannel, DISCORD_CAPABILITIES } from "../src/host/channel"
import type { DiscordSessionEvents } from "../src/host/connection"
import type { DiscordActions, DiscordOutgoingMessage } from "../src/host/discord"
import type { DiscordSettings } from "../src/host/fields"
import { homeOf } from "../src/host/home"
import type { IncidentNoticeRecord } from "../src/host/incidents/domain"
import {
  adoptIncidentNotices,
  openIncidentNotices,
  purgeIncidentNotices,
} from "../src/host/incidents/records"
import { renderIncidentCard } from "../src/host/incidents/render"
import { openProfileRecords } from "../src/host/profile/records"
import { openInquiryCards } from "../src/host/senders/records"
import {
  ALLOWED,
  CHANNEL_SETTINGS,
  DM_SETTINGS,
  fakeActions,
  fakeLink,
  HOME_CHANNEL,
  manualClock,
  memoryApprovalTables,
  memoryTable,
  OTHER,
} from "./support"

function incident(overrides: Partial<VaultIncidentView> = {}): VaultIncidentView {
  return {
    id: "vinc-0123456789ab",
    botId: "b1",
    sessionId: "session-1",
    at: 1_700_000_000_000,
    source: "tool-result",
    tool: "bash",
    grantId: "cred-abcdef",
    label: "Example login",
    kind: "password",
    outcome: "redacted",
    ...overrides,
  }
}

const textOf = (message: DiscordOutgoingMessage) =>
  [message.content, ...(message.embeds ?? []).flatMap((embed) => [embed.title, embed.description])]
    .filter((part) => part !== undefined)
    .join("\n")

describe("credential incident cards", () => {
  it("say which bot, which login, where, when and that the value was withheld", () => {
    const card = renderIncidentCard(incident(), "Helper", "en")
    expect(card.content).toBe(
      "🔒 A secret of one of Helper's logins turned up where the bot reads; it was withheld.",
    )
    expect(card.embeds?.[0]?.description?.split("\n\n")).toEqual([
      "**Login**: Example login (password)",
      "**Where**: in the result of the tool **bash**",
      "**When**: <t:1700000000:f> (<t:1700000000:R>)",
      "**Outcome**: Withheld: the value was replaced before the model read it.",
      "-# Acknowledge it in the Web UI, under Logins in the bot's settings; the Web UI shows it until then.",
    ])
    expect(card.components).toBeUndefined()
  })

  it("always tell the owner to change the password once the model read it", () => {
    const exposed = (overrides: Partial<VaultIncidentView>, locale: "en" | "ja") =>
      textOf(renderIncidentCard(incident({ outcome: "exposed", ...overrides }), "Helper", locale))
    expect(exposed({}, "en")).toContain("Exposed: the model already had the value.")
    expect(exposed({}, "en")).toContain("⚠️ Change the password of Example login now")
    expect(exposed({}, "ja")).toContain("⚠️ 今すぐ Example login のパスワードを変更してください。")
    expect(exposed({ kind: "passkey" }, "en")).toMatch(/passkey.*change its password/)
    expect(exposed({ kind: "otp" }, "ja")).toContain("パスワードも変更してください")
    for (const outcome of ["redacted"] as const) {
      expect(textOf(renderIncidentCard(incident({ outcome }), "Helper", "en"))).not.toContain(
        "Change the password",
      )
    }
  })

  it("name where it happened for every source, in Japanese too", () => {
    const where = (overrides: Partial<VaultIncidentView>) =>
      renderIncidentCard(incident(overrides), "Helper", "ja").embeds?.[0]?.description?.split(
        "\n\n",
      )[1]
    expect(where({})).toBe("**どこで**: ツール **bash** の結果")
    expect(where({ source: "tool-arguments", tool: "web_fetch" })).toBe(
      "**どこで**: ツール **web\\_fetch** の引数（呼び出しは断りました）",
    )
    expect(where({ source: "assistant-message", tool: undefined })).toBe(
      "**どこで**: ボットが書いた返答",
    )
    expect(where({ source: "tool-arguments", tool: undefined })).toBe(
      "**どこで**: ツール （不明） の引数（呼び出しは断りました）",
    )
    expect(where({ source: "inbound-message", tool: undefined })).toBe(
      "**どこで**: ボットに送られたメッセージ",
    )
    expect(where({ source: "bot-context", tool: undefined })).toBe(
      "**どこで**: ボットに渡す情報（通知・アクションの結果・メモ・スキル）",
    )
    const whereEn = (overrides: Partial<VaultIncidentView>) =>
      renderIncidentCard(incident(overrides), "Helper", "en").embeds?.[0]?.description?.split(
        "\n\n",
      )[1]
    expect(whereEn({ source: "inbound-message", tool: undefined })).toBe(
      "**Where**: in a message sent to the bot",
    )
    expect(whereEn({ source: "bot-context", tool: undefined })).toBe(
      "**Where**: in what the bot was handed (a notice, an action's result, notes or skills)",
    )
  })

  it("count the repeats of an incident and name the last time", () => {
    const when = (overrides: Partial<VaultIncidentView>, locale: "en" | "ja") =>
      renderIncidentCard(incident(overrides), "Helper", locale).embeds?.[0]?.description?.split(
        "\n\n",
      )[2]
    expect(when({ repeats: 2, lastAt: 1_700_000_600_000 }, "en")).toBe(
      "**When**: <t:1700000000:f> (<t:1700000000:R>)\n3 times in all, last <t:1700000600:f> (<t:1700000600:R>)",
    )
    expect(when({ repeats: 1, lastAt: 1_700_000_060_000 }, "ja")).toBe(
      "**いつ**: <t:1700000000:f> (<t:1700000000:R>)\n計 2 回、最後は <t:1700000060:f> (<t:1700000060:R>)",
    )
    expect(when({}, "en")).toBe("**When**: <t:1700000000:f> (<t:1700000000:R>)")
  })

  it("show names as typed: no mentions, links or formatting", () => {
    const text = textOf(
      renderIncidentCard(incident({ label: "@everyone [x](https://e)" }), "<@1> **Bot**", "en"),
    )
    expect(text).toContain("\\@everyone \\[x\\]\\(https\\://e\\)")
    expect(text).toContain("\\<\\@1\\> \\*\\*Bot\\*\\*")
  })

  it("carry nothing of the incident beyond the fields they name", () => {
    const secret = "hunter2-Sup3r-secret"
    const withValue = {
      ...incident({ outcome: "exposed" }),
      value: secret,
      secret,
    } as VaultIncidentView
    for (const locale of ["en", "ja"] as const) {
      const serialized = JSON.stringify(renderIncidentCard(withValue, "Helper", locale))
      expect(serialized).not.toContain(secret)
      expect(serialized).not.toContain("session-1")
      expect(serialized).not.toContain("cred-abcdef")
    }
  })
})

function connect(options: {
  settings?: DiscordSettings
  table: ReturnType<typeof memoryTable<IncidentNoticeRecord>>
  actions?: Partial<DiscordActions>
  language?: string
}) {
  const settings = { ...(options.settings ?? DM_SETTINGS), language: options.language ?? "" }
  const link = fakeLink(settings)
  const { actions, calls } = fakeActions(options.actions)
  let events: DiscordSessionEvents | undefined
  const bridge = createDiscordBridge({
    link: link.link,
    home: homeOf(settings),
    adopt: (channelId) => adoptIncidentNotices(options.table, "b1", channelId),
    channelId: "discord",
    connect(supplied) {
      events = supplied
      return { ...actions, async close() {} }
    },
    scheduler: manualClock().scheduler,
    fetch: async () => ({ ok: false, status: 404, body: (async function* () {})() }),
    records: openApprovalRecords(memoryApprovalTables(), "b1"),
    incidents: openIncidentNotices(options.table, "b1"),
    profiles: openProfileRecords(memoryTable(), "b1"),
    inquiries: openInquiryCards(memoryTable(), "b1"),
    warn: () => {},
  })
  events?.ready({ id: "self", username: "bot", tag: "bot" })
  const sends = () => calls.filter((call) => /^send \S+ \S/.test(call))
  const cards = () => sends().filter((call) => call.includes("🔒"))
  return { bridge, sends, cards, link }
}

const output = (view: VaultIncidentView) =>
  ({ kind: "credential-incident", incident: view }) as const

describe("Discord bridge: credential incidents", () => {
  it("are declared, for the owners field", () => {
    expect(DISCORD_CAPABILITIES.credentialIncidents).toBe(true)
    const channel = createDiscordChannel({
      open: () => {
        throw new Error("not connected")
      },
      lookup: () => {
        throw new Error("not looked up")
      },
      scheduler: manualClock().scheduler,
      fetch: async () => ({ ok: false, status: 404, body: (async function* () {})() }),
      approvals: memoryApprovalTables(),
      incidents: memoryTable(),
      profiles: memoryTable(),
      inquiryCards: memoryTable(),
      warn: () => {},
    })
    expect(channel.owners).toBe("approvers")
    expect(channel.capabilities.credentialIncidents).toBe(true)
  })

  it("go to the home once, the home channel for a channel home", async () => {
    const table = memoryTable<IncidentNoticeRecord>()
    const { bridge, cards } = connect({ settings: CHANNEL_SETTINGS, table })
    await bridge.receive(output(incident()))
    await bridge.receive(output(incident()))
    expect(cards().map((call) => call.split(" ")[1])).toEqual([HOME_CHANNEL])
    expect([...table.map.values()]).toEqual([
      {
        botId: "b1",
        incidentId: "vinc-0123456789ab",
        channelId: HOME_CHANNEL,
        messageId: expect.any(String),
      },
    ])
  })

  it("show each incident once across connections, and after a change of home again at the new one", async () => {
    const table = memoryTable<IncidentNoticeRecord>()
    const first = connect({ table })
    await first.bridge.receive(output(incident()))
    expect(first.cards()).toHaveLength(1)

    const second = connect({ table })
    await second.bridge.receive(output(incident()))
    await second.bridge.receive(output(incident({ id: "vinc-other" })))
    expect(second.cards()).toEqual([
      `send dm-${ALLOWED} ${renderIncidentCard(incident(), "Bot", "en").content}`,
    ])
    expect([...table.map.keys()]).toEqual(["b1:vinc-0123456789ab", "b1:vinc-other"])

    const moved = connect({ settings: CHANNEL_SETTINGS, table })
    await moved.bridge.receive(output(incident()))
    expect(moved.cards().map((call) => call.split(" ")[1])).toEqual([HOME_CHANNEL])
  })

  it("keep a version 2 notice of the owner's DM, and forget those of other DMs", async () => {
    const table = memoryTable<IncidentNoticeRecord>()
    const v2 = (userId: string) => ({
      botId: "b1",
      incidentId: "vinc-0123456789ab",
      userId,
      channelId: `dm-${userId}`,
      messageId: "900000000000000001",
    })
    await table.put(`b1:vinc-0123456789ab:${ALLOWED}`, v2(ALLOWED))
    await table.put(`b1:vinc-0123456789ab:${OTHER}`, v2(OTHER))
    const { bridge, cards } = connect({ table })
    await bridge.receive(output(incident()))
    expect(cards()).toEqual([])
    expect([...table.map.keys()]).toEqual(["b1:vinc-0123456789ab"])
  })

  it("follow the notice language", async () => {
    const { bridge, sends } = connect({ table: memoryTable(), language: "ja" })
    await bridge.receive(output(incident({ outcome: "exposed" })))
    expect(sends()).toEqual([
      `send dm-${ALLOWED} 🚨 Bot のモデルがログイン情報の秘密を読みました。`,
    ])
  })

  it("fail when the home refused it, and post it on the next connection", async () => {
    const table = memoryTable<IncidentNoticeRecord>()
    const refusing = connect({
      table,
      actions: {
        async send() {
          throw new Error("Cannot send messages to this user")
        },
      },
    })
    await expect(refusing.bridge.receive(output(incident()))).rejects.toThrow(
      "Cannot send messages to this user",
    )
    expect(table.map.size).toBe(0)
    const next = connect({ table })
    await next.bridge.receive(output(incident()))
    expect(next.cards()).toHaveLength(1)
  })

  it("refuse another bot's incident", async () => {
    const { bridge, sends } = connect({ table: memoryTable() })
    await expect(bridge.receive(output(incident({ botId: "b2" })))).rejects.toThrow(
      "is not of bot b1",
    )
    expect(sends()).toEqual([])
  })
})

describe("stored incident notices", () => {
  it("drop only the notices of bots that are gone", async () => {
    const table = memoryTable<IncidentNoticeRecord>()
    for (const botId of ["kept", "gone"]) {
      await openIncidentNotices(table, botId).save({
        incidentId: "vinc-1",
        channelId: "c",
        messageId: "m",
      })
    }
    await purgeIncidentNotices(table, (botId) => botId === "kept")
    expect([...table.map.keys()]).toEqual(["kept:vinc-1"])
    expect(openIncidentNotices(table, "kept").shown("vinc-1")).toBe(true)
    expect(openIncidentNotices(table, "kept").shown("vinc-2")).toBe(false)
  })
})
