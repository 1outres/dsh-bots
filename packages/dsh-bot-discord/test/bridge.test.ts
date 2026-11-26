import type { BotChannelOutput } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { openApprovalRecords } from "../src/host/actions/records"
import { ACCEPTED_REACTION, createDiscordBridge, FAILED_REACTION } from "../src/host/bridge"
import type { DiscordSessionEvents } from "../src/host/connection"
import type {
  DiscordActions,
  DiscordCommandInvocation,
  DiscordCommandResponse,
} from "../src/host/discord"
import type { FetchUrl } from "../src/host/download"
import { homeOf } from "../src/host/home"
import { openIncidentNotices } from "../src/host/incidents/records"
import { PULSE_DELAY_MS, TYPING_INTERVAL_MS } from "../src/host/typing"
import {
  ALLOWED,
  author,
  channelMessage,
  directMessage,
  fakeActions,
  fakeLink,
  GUILD,
  HOME_CHANNEL,
  manualClock,
  memoryApprovalTables,
  memoryTable,
  OTHER,
  settle,
} from "./support"

function setup(
  options: {
    home?: string
    approvers?: readonly string[]
    actions?: Partial<DiscordActions>
    running?: boolean
    language?: string
    fetch?: FetchUrl
  } = {},
) {
  const clock = manualClock()
  const settings = {
    token: "tok",
    home: options.home ?? "dm",
    approvers: options.approvers ?? [ALLOWED],
    language: options.language ?? "",
  }
  const link = fakeLink(settings)
  if (options.running === true) link.setActivity("running")
  const { actions, calls } = fakeActions(options.actions)
  const tables = memoryApprovalTables()
  let events: DiscordSessionEvents | undefined
  let disconnected = 0
  const connection = createDiscordBridge({
    link: link.link,
    home: homeOf(settings),
    adopt: async () => {},
    channelId: "discord",
    connect(supplied) {
      events = supplied
      return {
        ...actions,
        async close() {
          disconnected += 1
        },
      }
    },
    scheduler: clock.scheduler,
    fetch:
      options.fetch ??
      (async () => ({
        ok: true,
        status: 200,
        body: (async function* () {
          yield new Uint8Array([1, 2])
        })(),
      })),
    records: openApprovalRecords(tables, "b1"),
    incidents: openIncidentNotices(memoryTable(), "b1"),
    warn: () => {},
  })
  const ready = () => events?.ready({ id: "self", tag: "bot" })
  ready()
  const responses: DiscordCommandResponse[] = []
  const command = (overrides: Partial<DiscordCommandInvocation> = {}) =>
    events?.command({
      name: "status",
      userId: ALLOWED,
      guildId: null,
      channelId: "dm-in",
      locale: "en-US",
      async respond(response) {
        responses.push(response)
      },
      ...overrides,
    })
  return {
    clock,
    link,
    calls,
    connection,
    receive: (output: BotChannelOutput) => connection.receive(output),
    reply: (text: string) =>
      connection.receive({ kind: "reply", reply: { id: "r", text, interrupted: false } }),
    turn: (turn: Extract<BotChannelOutput, { kind: "turn" }>["turn"]) =>
      connection.receive({ kind: "turn", turn }),
    dm: (message = directMessage()) => events?.message(message),
    command,
    responses,
    ready,
    disconnected: () => disconnected,
  }
}

const typings = (calls: readonly string[]) => calls.filter((call) => call.startsWith("typing"))
const without = (calls: readonly string[], prefix: string) => {
  const digests = new Set(
    calls.flatMap((call) => {
      const pinned = /^pin \S+ m(\d+)$/.exec(call)
      return pinned === null ? [] : [Number(pinned[1]) - 1]
    }),
  )
  return calls.filter(
    (call, index) =>
      !call.startsWith(prefix) &&
      !call.startsWith("openDm") &&
      !call.startsWith("pin ") &&
      !digests.has(index),
  )
}
const sends = (calls: readonly string[]) =>
  without(calls, "commands").filter((call) => call.startsWith("send"))

describe("Discord bridge: inbound", () => {
  it("delivers an allowed user's direct message and reacts with eyes once accepted", async () => {
    const { link, calls, dm } = setup()
    dm()
    await settle()
    expect(link.texts()).toEqual(["hello"])
    expect(link.delivered[0]).toMatchObject({ sentAt: 1_700_000_000_000, attachments: [] })
    expect(without(calls, "commands")).toEqual([`react dm-in 1001 ${ACCEPTED_REACTION}`])
  })

  it("passes attachments with their declared size and type, read from Discord's CDN on demand", async () => {
    const fetched: string[] = []
    const { link, dm } = setup({
      fetch: async (url) => {
        fetched.push(url)
        return {
          ok: true,
          status: 200,
          body: (async function* () {
            yield new Uint8Array([1, 2, 3])
          })(),
        }
      },
    })
    dm(
      directMessage({
        content: "",
        attachments: [
          {
            name: "a.png",
            url: "https://cdn.discordapp.com/attachments/1/2/a.png",
            size: 3,
            contentType: "image/png",
          },
          {
            name: "b.bin",
            url: "https://cdn.discordapp.com/attachments/1/2/b",
            size: 3,
            contentType: null,
          },
        ],
      }),
    )
    await settle()
    const [message] = link.delivered
    expect(
      message?.attachments.map(({ name, bytes, mediaType }) => ({ name, bytes, mediaType })),
    ).toEqual([
      { name: "a.png", bytes: 3, mediaType: "image/png" },
      { name: "b.bin", bytes: 3, mediaType: undefined },
    ])
    expect(fetched).toEqual([])
    expect(await message?.attachments[0]?.read(10, new AbortController().signal)).toEqual(
      new Uint8Array([1, 2, 3]),
    )
    await expect(message?.attachments[1]?.read(2, new AbortController().signal)).rejects.toThrow(
      "larger than 2 bytes",
    )
    expect(fetched).toEqual([
      "https://cdn.discordapp.com/attachments/1/2/a.png",
      "https://cdn.discordapp.com/attachments/1/2/b",
    ])
  })

  it("ignores server channels, other users, bots, itself, system and empty messages", async () => {
    const { link, calls, dm } = setup()
    dm(directMessage({ guildId: "g1" }))
    dm(directMessage({ author: author(OTHER) }))
    dm(directMessage({ author: author(ALLOWED, true) }))
    dm(directMessage({ author: author("self") }))
    dm(directMessage({ kind: "other", content: "pinned" }))
    dm(directMessage({ content: "  " }))
    await settle()
    expect(link.delivered).toEqual([])
    expect(without(calls, "commands")).toEqual([])
  })

  it("delivers messages in arrival order, each once", async () => {
    const { link, dm } = setup()
    dm(directMessage({ id: "1001", content: "first" }))
    dm(directMessage({ id: "1002", content: "second" }))
    dm(directMessage({ id: "1002", content: "second" }))
    dm(directMessage({ id: "1003", kind: "reply", content: "third" }))
    await settle()
    expect(link.texts()).toEqual(["first", "second", "third"])
  })

  it("reads the messages missed while a new Gateway session started, before newer ones", async () => {
    const missed = [
      directMessage({ id: "1003", content: "missed later" }),
      directMessage({ id: "1002", content: "missed" }),
      directMessage({ id: "1004", author: author("self", true), content: "reply" }),
    ]
    const pages: string[] = []
    const { link, dm, ready } = setup({
      actions: {
        async messagesAfter(channelId, after) {
          pages.push(`${channelId} ${after}`)
          return after === "1001" ? missed : []
        },
      },
    })
    dm(directMessage({ id: "1001", content: "before" }))
    await settle()
    ready()
    dm(directMessage({ id: "1003", content: "missed later" }))
    dm(directMessage({ id: "1005", content: "after" }))
    await settle()
    expect(link.texts()).toEqual(["before", "missed", "missed later", "after"])
    expect(pages).toEqual(["dm-in 1001"])
  })

  it("reads further pages while a page is full", async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) =>
        directMessage({ id: String(from + index), content: `m${from + index}` }),
      )
    const pages: string[] = []
    const { link, dm, ready } = setup({
      actions: {
        async messagesAfter(_channelId, after) {
          pages.push(after)
          return after === "1000" ? page(1001, 100) : page(1101, 3)
        },
      },
    })
    dm(directMessage({ id: "1000", content: "start" }))
    await settle()
    ready()
    await settle()
    expect(pages).toEqual(["1000", "1100"])
    expect(link.delivered).toHaveLength(104)
    expect(link.texts().at(-1)).toBe("m1103")
  })

  it("reacts with a warning and replies with the reason when the message was not delivered", async () => {
    const { link, calls, dm } = setup({ language: "ja" })
    link.refuse({ code: "too-large", message: 'The file "a.zip" (30 MiB) is larger than 25 MiB.' })
    dm()
    await settle()
    expect(without(calls, "commands")).toEqual([
      `react dm-in 1001 ${FAILED_REACTION}`,
      'send dm-in ⚠️ 届けられませんでした: The file "a.zip" (30 MiB) is larger than 25 MiB. (reply to 1001)',
    ])
  })
})

describe("Discord bridge: outbound", () => {
  it("sends the Main session's replies to the owner's DM, split to 2000", async () => {
    const { reply, calls } = setup()
    await reply("x".repeat(2500))
    const sent = sends(calls)
    expect(sent.map((call) => call.split(" ")[1])).toEqual([`dm-${ALLOWED}`, `dm-${ALLOWED}`])
    expect(sent.map((call) => call.split(" ")[2]?.length)).toEqual([2000, 500])
  })

  it("formats a reply's tables as code blocks", async () => {
    const { reply, calls } = setup()
    await reply("| a | b |\n|---|---|\n| 1 | 22 |")
    expect(sends(calls)).toEqual([`send dm-${ALLOWED} \`\`\`\na | b\n--+---\n1 | 22\n\`\`\``])
  })

  it("replies in the DM channel the owner wrote from", async () => {
    const { reply, calls, dm } = setup()
    await settle()
    dm()
    await settle()
    await reply("answer")
    expect(calls).toContain("send dm-in answer")
  })

  it("posts everything to the home channel, never opening a DM, and takes anyone's message there", async () => {
    const { reply, calls, dm, link } = setup({ home: `${GUILD}:${HOME_CHANNEL}` })
    dm(channelMessage({ author: author(OTHER) }))
    dm(directMessage())
    await settle()
    await reply("answer")
    expect(link.delivered.map((message) => message.place)).toEqual([
      { kind: "channel", channel: "general", server: "Team" },
    ])
    expect(calls).toContain(`send ${HOME_CHANNEL} answer`)
    expect(calls.some((call) => call.startsWith("openDm"))).toBe(false)
  })

  it("uploads a file with its caption to the home, and fails when Discord refuses it", async () => {
    const { receive, calls } = setup()
    await receive({
      kind: "file",
      file: { name: "r.pdf", data: new Uint8Array(3), caption: "here" },
    })
    expect(sends(calls)).toEqual([`send dm-${ALLOWED} here [r.pdf 3]`])
    const refused = setup({
      actions: {
        async send() {
          throw new Error("Request entity too large")
        },
      },
    })
    await expect(
      refused.receive({ kind: "file", file: { name: "r.pdf", data: new Uint8Array(3) } }),
    ).rejects.toThrow("Request entity too large")
  })

  it("sends a long caption as messages before the one carrying the file", async () => {
    const { receive, calls } = setup()
    await receive({
      kind: "file",
      file: {
        name: "r.pdf",
        data: new Uint8Array(3),
        caption: `${"a".repeat(1500)} ${"b".repeat(1500)}`,
      },
    })
    expect(sends(calls)).toEqual([
      `send dm-${ALLOWED} ${"a".repeat(1500)}`,
      `send dm-${ALLOWED} ${"b".repeat(1500)} [r.pdf 3]`,
    ])
  })

  it("refuses a file once closing, so its sender does not count it as sent", async () => {
    const { receive, connection } = setup()
    await connection.close()
    await expect(
      receive({ kind: "file", file: { name: "r.pdf", data: new Uint8Array(3) } }),
    ).rejects.toThrow("closing")
  })

  it("keeps serving after bot-core fails to take a message", async () => {
    const { link, dm, calls } = setup()
    const deliver = link.link.deliver
    let first = true
    ;(link.link as { deliver: typeof deliver }).deliver = async (message) => {
      if (first) {
        first = false
        throw new Error("boom")
      }
      return deliver(message)
    }
    dm()
    dm(directMessage({ id: "1002", content: "again" }))
    await settle()
    expect(link.texts()).toEqual(["again"])
    expect(calls).toContain(`react dm-in 1002 ${ACCEPTED_REACTION}`)
  })

  it("tells the DMs when a turn failed or was stopped, in the notice language", async () => {
    const english = setup()
    await english.turn({ phase: "started" })
    await english.turn({ phase: "failed", message: "429 Too Many Requests" })
    await english.turn({ phase: "completed" })
    await english.turn({ phase: "cancelled", by: "user" })
    expect(sends(english.calls)).toEqual([
      `send dm-${ALLOWED} ⚠️ The reply failed: 429 Too Many Requests`,
      `send dm-${ALLOWED} ⏹️ Stopped.`,
    ])
    const japanese = setup({ language: "ja" })
    await japanese.turn({ phase: "cancelled", by: "system" })
    expect(sends(japanese.calls)).toEqual([`send dm-${ALLOWED} ⏹️ 応答が中断されました。`])
  })

  it("keeps the DMs typing while a turn runs, and stops when it ends", async () => {
    const { clock, turn, reply, calls } = setup()
    await turn({ phase: "started" })
    await settle()
    clock.advance(TYPING_INTERVAL_MS)
    await settle()
    clock.advance(TYPING_INTERVAL_MS)
    await settle()
    expect(typings(calls)).toHaveLength(3)
    await reply("more to come")
    await settle()
    expect(typings(calls)).toHaveLength(3)
    clock.advance(PULSE_DELAY_MS)
    await settle()
    expect(typings(calls)).toHaveLength(4)
    await reply("done")
    await turn({ phase: "completed" })
    clock.advance(TYPING_INTERVAL_MS * 5)
    await settle()
    expect(typings(calls)).toHaveLength(4)
    expect(clock.pending()).toBe(0)
  })

  it("does not show typing queued behind a reply once the turn ended", async () => {
    let release: () => void = () => {}
    const sent: string[] = []
    const { reply, turn, calls } = setup({
      actions: {
        async send(channelId, message) {
          if (message.content !== "working") return "digest"
          await new Promise<void>((resolve) => {
            release = resolve
          })
          sent.push(`${channelId} ${message.content}`)
          return "sent"
        },
      },
    })
    const replied = reply("working")
    await settle()
    void turn({ phase: "started" })
    void turn({ phase: "completed" })
    release()
    await replied
    await settle()
    expect(sent).toEqual([`dm-${ALLOWED} working`])
    expect(typings(calls)).toEqual([])
  })

  it("starts typing at once when connected during a running turn", async () => {
    const { calls } = setup({ running: true })
    await settle()
    expect(calls).toContain(`typing dm-${ALLOWED}`)
  })
})

describe("Discord bridge: interactions", () => {
  it("posts an opened interaction to the home, in order with replies, and closes it", async () => {
    const { receive, reply, calls } = setup()
    await reply("Let me ask.")
    await receive({
      kind: "interaction-opened",
      interaction: { id: "p1", kind: "plan-review", question: "Go?", plan: "# Plan" },
    })
    await receive({
      kind: "interaction-closed",
      closure: { id: "p1", kind: "plan-review", resolution: { kind: "withdrawn" } },
    })
    await settle()
    const posted = without(calls, "commands").filter((call) => /^(send|edit)/.test(call))
    expect(posted.slice(0, 3)).toEqual([
      `send dm-${ALLOWED} Let me ask.`,
      `send dm-${ALLOWED} **Plan review**\n\n# Plan`,
      `send dm-${ALLOWED} `,
    ])
    expect(posted[3]).toMatch(/^edit dm-\d+ m\d+ ⏹️ Withdrawn/)
  })
})

describe("Discord bridge: commands", () => {
  it("registers bot-core's commands on every new Gateway session", async () => {
    const { calls, ready } = setup()
    ready()
    await settle()
    expect(calls.filter((call) => call.startsWith("commands"))).toEqual([
      "commands stop,status,pending",
      "commands stop,status,pending",
    ])
  })

  it("runs a command for an allowed user in a DM and answers in their language", async () => {
    const { link, command, responses } = setup()
    link.answerWith({
      ok: true,
      result: {
        command: "status",
        status: {
          activity: "running",
          loaded: true,
          model: { provider: "deepseek", model: "chat" },
          queued: 1,
        },
      },
    })
    command({ locale: "ja" })
    await settle()
    expect(link.commands).toEqual(["status"])
    expect(responses).toEqual([
      { content: "🟢 応答中\nモデル: deepseek / chat\n待機中のメッセージ: 1", ephemeral: false },
    ])
    link.answerWith({ ok: true, result: { command: "stop", outcome: "stopped" } })
    command({ name: "stop" })
    await settle()
    expect(responses.at(-1)).toEqual({ content: "⏹️ Stopping the current turn.", ephemeral: false })
  })

  it("refuses commands away from the home and unknown ones privately, running nothing", async () => {
    const { link, command, responses } = setup()
    command({ userId: OTHER })
    command({ guildId: GUILD, channelId: HOME_CHANNEL })
    command({ name: "reboot" })
    await settle()
    expect(link.commands).toEqual([])
    const away = {
      content: "This bot is used in its home only (the channel or the DM its settings name).",
      ephemeral: true,
    }
    expect(responses).toEqual([
      away,
      away,
      { content: "This command is not offered any more.", ephemeral: true },
    ])
  })

  it("takes commands in the home channel from anyone, and refuses them in DMs and other channels", async () => {
    const { link, command, responses } = setup({ home: `${GUILD}:${HOME_CHANNEL}` })
    command({ userId: OTHER, guildId: GUILD, channelId: HOME_CHANNEL })
    command({ guildId: null, channelId: "dm-in" })
    command({ guildId: GUILD, channelId: "555555555555555555" })
    await settle()
    expect(link.commands).toEqual(["status"])
    expect(responses.filter((response) => response.ephemeral)).toHaveLength(2)
    expect(responses.filter((response) => !response.ephemeral)).toHaveLength(1)
  })
})

describe("Discord bridge: lifecycle", () => {
  it("stays silent once bot-core aborts the link, and disconnects", async () => {
    const { link, calls, dm, reply, turn, disconnected } = setup()
    await settle()
    const before = calls.length
    link.controller.abort()
    dm()
    await expect(turn({ phase: "started" })).rejects.toThrow("closing")
    await expect(reply("late")).rejects.toThrow("closing")
    await settle()
    expect(link.delivered).toEqual([])
    expect(calls).toHaveLength(before)
    expect(disconnected()).toBe(1)
  })

  it("disconnects and stops typing on close, once", async () => {
    const { clock, link, connection, disconnected, calls, dm } = setup({ running: true })
    await settle()
    await Promise.all([connection.close(), connection.close()])
    link.controller.abort()
    await settle()
    expect(disconnected()).toBe(1)
    expect(clock.pending()).toBe(0)
    const before = calls.length
    dm()
    await settle()
    expect(calls).toHaveLength(before)
    expect(link.delivered).toEqual([])
  })
})
