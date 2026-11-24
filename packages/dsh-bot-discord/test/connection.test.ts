import type { BotChannelConnectionState } from "@1outres/dsh-bot-core"
import { describe, expect, it } from "vitest"
import { BASE_RETRY_MS, createDiscordConnection, MAX_RETRY_MS } from "../src/host/connection"
import type { DiscordAccount, DiscordClientEvents, DiscordMessage } from "../src/host/discord"
import { directMessage, fakeActions, manualClock } from "./support"

function setup() {
  const clock = manualClock()
  const reports: BotChannelConnectionState[] = []
  const sessions: DiscordAccount[] = []
  const messages: DiscordMessage[] = []
  const commands: string[] = []
  const clients: { token: string; events: DiscordClientEvents; destroyed: number }[] = []
  const { actions, calls } = fakeActions()
  const connection = createDiscordConnection({
    token: "secret-token",
    open(token, events) {
      const client = { token, events, destroyed: 0 }
      clients.push(client)
      return {
        ...actions,
        async destroy() {
          client.destroyed += 1
        },
      }
    },
    scheduler: clock.scheduler,
    events: {
      ready: (account) => sessions.push(account),
      message: (message) => messages.push(message),
      command: (invocation) => commands.push(invocation.name),
      component: () => {},
      modal: () => {},
    },
    report: (state) => reports.push(state),
  })
  const latest = () => {
    const client = clients.at(-1)
    if (client === undefined) throw new Error("no client")
    return client
  }
  return { clock, reports, sessions, messages, commands, clients, latest, connection, calls }
}

const ACCOUNT = { id: "self", tag: "bot#0001" }

describe("Discord connection", () => {
  it("logs in with the token and reports connecting, then the account on ready", () => {
    const { reports, sessions, latest } = setup()
    expect(latest().token).toBe("secret-token")
    latest().events.ready(ACCOUNT)
    expect(reports).toEqual([{ state: "connecting" }, { state: "connected", account: "bot#0001" }])
    expect(sessions).toEqual([ACCOUNT])
  })

  it("keeps the account through a reconnect and a resume", () => {
    const { reports, sessions, latest } = setup()
    latest().events.ready(ACCOUNT)
    latest().events.reconnecting()
    latest().events.resumed()
    expect(reports.slice(2)).toEqual([
      { state: "connecting" },
      { state: "connected", account: "bot#0001" },
    ])
    expect(sessions).toHaveLength(1)
  })

  it("passes every new session, message and command on", () => {
    const { sessions, messages, commands, latest } = setup()
    latest().events.ready(ACCOUNT)
    latest().events.message(directMessage())
    latest().events.command({
      name: "status",
      userId: "1",
      guildId: null,
      locale: "en-US",
      respond: async () => {},
    })
    latest().events.ready(ACCOUNT)
    expect(sessions).toHaveLength(2)
    expect(messages).toEqual([directMessage()])
    expect(commands).toEqual(["status"])
  })

  it("stops for good on a failure that cannot be retried", () => {
    const { clock, reports, clients, latest } = setup()
    latest().events.failed({ retryable: false, reason: "Discord rejected the bot token" })
    clock.advance(MAX_RETRY_MS * 4)
    expect(clients).toHaveLength(1)
    expect(reports.at(-1)).toEqual({ state: "failed", message: "Discord rejected the bot token" })
    expect(clock.pending()).toBe(0)
  })

  it("replaces a client that failed to connect, backing off up to a minute", () => {
    const { clock, reports, clients, latest } = setup()
    const delays: number[] = []
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const before = clock.now()
      const count = clients.length
      latest().events.failed({ retryable: true, reason: "offline" })
      while (clients.length === count) clock.advance(100)
      delays.push(clock.now() - before)
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000])
    expect(reports.slice(0, 3)).toEqual([
      { state: "connecting" },
      { state: "failed", message: "offline" },
      { state: "connecting" },
    ])
    latest().events.ready(ACCOUNT)
    latest().events.failed({ retryable: true, reason: "offline" })
    const count = clients.length
    clock.advance(BASE_RETRY_MS)
    expect(clients).toHaveLength(count + 1)
  })

  it("uses the current client's actions", async () => {
    const { connection, calls } = setup()
    await connection.send("dm-1", { content: "hi" })
    await connection.typing("dm-1")
    await connection.registerCommands([{ name: "stop", description: "Stop" }])
    expect(calls).toEqual(["send dm-1 hi", "typing dm-1", "commands stop"])
  })

  it("destroys the client on close, cancels a retry and ignores late events", async () => {
    const { clock, reports, clients, latest, connection, sessions } = setup()
    const first = latest()
    first.events.failed({ retryable: true, reason: "offline" })
    await connection.close()
    await connection.close()
    clock.advance(MAX_RETRY_MS)
    first.events.ready(ACCOUNT)
    expect(clients).toHaveLength(1)
    expect(first.destroyed).toBe(1)
    expect(sessions).toEqual([])
    expect(reports).toHaveLength(2)
  })

  it("ignores a replaced client's events", () => {
    const { clock, sessions, latest } = setup()
    const first = latest()
    first.events.failed({ retryable: true, reason: "offline" })
    clock.advance(BASE_RETRY_MS)
    first.events.ready(ACCOUNT)
    expect(sessions).toEqual([])
    latest().events.ready(ACCOUNT)
    expect(sessions).toEqual([ACCOUNT])
  })
})
