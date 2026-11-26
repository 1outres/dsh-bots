import {
  Client,
  type ClientOptions,
  DiscordAPIError,
  DiscordjsError,
  DiscordjsErrorCodes,
  Events,
  GatewayDispatchEvents,
  GatewayIntentBits,
  Partials,
  RESTJSONErrorCodes,
  SimpleShardingStrategy,
} from "discord.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import type {
  DiscordClientEvents,
  DiscordCommandInvocation,
  DiscordComponentPress,
  DiscordFailure,
  DiscordGatewayMode,
  DiscordMessage,
  DiscordModalSubmit,
} from "../src/host/discord"
import { openDiscordJsClient } from "../src/host/discordjs/client"
import { clientOptions } from "../src/host/discordjs/options"
import { ALLOWED, settle } from "./support"

const DM = "300000000000000001"
const SELF = "400000000000000001"
const APP = "700000000000000001"

function rawUser(id: string, bot = false) {
  return {
    id,
    username: `user${id.slice(-2)}`,
    discriminator: "0",
    global_name: `User ${id.slice(-2)}`,
    avatar: null,
    bot,
  }
}

function rawMessage(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    channel_id: DM,
    channel_type: 1,
    type: 0,
    content: `message ${id}`,
    author: rawUser(ALLOWED),
    attachments: [],
    embeds: [],
    mentions: [],
    mention_roles: [],
    mention_everyone: false,
    pinned: false,
    tts: false,
    timestamp: "2026-11-23T00:00:00.000Z",
    edited_timestamp: null,
    flags: 0,
    ...overrides,
  }
}

interface Recorded {
  method: string
  route: string
  body?: unknown
  query?: string
  files?: { name: string; data: unknown }[]
}

type Rest = Record<"get" | "post" | "put", (route: string, options?: unknown) => Promise<unknown>>

const GATEWAY_BOT = {
  url: "wss://gateway.discord.invalid",
  shards: 1,
  session_start_limit: { total: 1000, remaining: 1000, reset_after: 0, max_concurrency: 1 },
}

function stubRest(client: Client, requests: Recorded[]) {
  const rest = client.rest as unknown as Rest
  const record =
    (method: string, answer: (route: string) => unknown) =>
    async (route: string, options?: unknown) => {
      const { body, query, files } = (options ?? {}) as {
        body?: unknown
        query?: URLSearchParams
        files?: Recorded["files"]
      }
      requests.push({
        method,
        route,
        body,
        query: query?.toString(),
        ...(files === undefined ? {} : { files }),
      })
      return answer(route)
    }
  vi.spyOn(rest, "post").mockImplementation(
    record("POST", (route) =>
      route === "/users/@me/channels"
        ? { id: DM, type: 1, last_message_id: null, recipients: [rawUser(ALLOWED)] }
        : route === `/channels/${DM}/messages`
          ? rawMessage("9")
          : undefined,
    ),
  )
  vi.spyOn(rest, "put").mockImplementation(record("PUT", () => undefined))
  vi.spyOn(rest, "get").mockImplementation(
    record("GET", () => [
      rawMessage("12", { type: 19 }),
      rawMessage("11", {
        attachments: [
          { id: "1", filename: "a.png", url: "https://cdn/a.png", proxy_url: "", size: 1 },
        ],
      }),
      rawMessage("13", { type: 6 }),
    ]),
  )
}

function setup(
  login: () => Promise<string> = () => new Promise<string>(() => {}),
  mode: DiscordGatewayMode = "dm",
) {
  const requests: Recorded[] = []
  const seen: string[] = []
  const failures: DiscordFailure[] = []
  const messages: DiscordMessage[] = []
  const invocations: DiscordCommandInvocation[] = []
  const presses: DiscordComponentPress[] = []
  const submits: DiscordModalSubmit[] = []
  const events: DiscordClientEvents = {
    ready: (account) => seen.push(`ready ${account.id} ${account.tag}`),
    resumed: () => seen.push("resumed"),
    reconnecting: () => seen.push("reconnecting"),
    message: (message) => messages.push(message),
    command: (invocation) => invocations.push(invocation),
    component: (press) => presses.push(press),
    modal: (submit) => submits.push(submit),
    failed: (failure) => failures.push(failure),
  }
  const created: Client[] = []
  const adapter = openDiscordJsClient("token", mode, events, {
    warn: () => {},
    create(options: ClientOptions) {
      const client = new Client(options)
      Object.assign(client, { user: { id: SELF } })
      stubRest(client, requests)
      vi.spyOn(client, "login").mockImplementation(login)
      created.push(client)
      return client
    },
  })
  const [client] = created
  if (client === undefined) throw new Error("no client was created")
  const destroy = vi.spyOn(client, "destroy")
  const dispatchMessage = (raw: Record<string, unknown>) =>
    (
      client as unknown as { actions: { MessageCreate: { handle(data: unknown): void } } }
    ).actions.MessageCreate.handle(raw)
  const ready = (discriminator = "0") =>
    client.ws.emit(
      GatewayDispatchEvents.Ready,
      { user: { ...rawUser(SELF, true), discriminator }, application: { id: APP, flags: 0 } },
      0,
    )
  return {
    client,
    adapter,
    requests,
    destroy,
    seen,
    failures,
    messages,
    invocations,
    presses,
    submits,
    dispatchMessage,
    ready,
  }
}

/** A client whose login really runs, against a stubbed /gateway/bot and in-process shards that only record. */
function loggingIn() {
  let answer: (value: unknown) => void = () => {}
  const gateway = new Promise((resolve) => {
    answer = resolve
  })
  const spawn = vi.spyOn(SimpleShardingStrategy.prototype, "spawn").mockResolvedValue()
  const connect = vi.spyOn(SimpleShardingStrategy.prototype, "connect").mockResolvedValue()
  const failures: DiscordFailure[] = []
  let client: Client | undefined
  const adapter = openDiscordJsClient(
    "token",
    "dm",
    {
      ready: () => {},
      resumed: () => {},
      reconnecting: () => {},
      message: () => {},
      command: () => {},
      component: () => {},
      modal: () => {},
      failed: (failure) => failures.push(failure),
    },
    {
      warn: () => {},
      create(options) {
        client = new Client(options)
        vi.spyOn(client.rest, "get").mockImplementation(() => gateway)
        return client
      },
    },
  )
  return { adapter, spawn, connect, failures, answer: () => answer(GATEWAY_BOT), client }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("discord.js client options", () => {
  it("ask for direct messages only in DM mode, take partial DM channels, and never ping", () => {
    const client = new Client(clientOptions("dm", () => false))
    expect(client.options.intents.bitfield).toBe(GatewayIntentBits.DirectMessages)
    expect(client.options.partials).toEqual([Partials.Channel])
    expect(client.options.allowedMentions).toEqual({ parse: [] })
  })

  it("ask for server messages, their content and members in channel mode, without DMs", () => {
    const client = new Client(clientOptions("channel", () => false))
    expect(client.options.intents.bitfield).toBe(
      GatewayIntentBits.Guilds |
        GatewayIntentBits.GuildMessages |
        GatewayIntentBits.MessageContent |
        GatewayIntentBits.GuildMembers,
    )
    expect(client.options.partials).toEqual([])
  })
})

describe("discord.js adapter: login", () => {
  it("spawns and connects the Gateway shards", async () => {
    const { adapter, spawn, connect, failures, answer } = loggingIn()
    answer()
    await settle()
    expect(spawn).toHaveBeenCalledWith([0])
    expect(connect).toHaveBeenCalledTimes(1)
    expect(failures).toEqual([])
    await adapter.destroy()
  })

  it("opens no Gateway connection once destroyed while fetching the Gateway", async () => {
    const { adapter, spawn, connect, failures, answer } = loggingIn()
    await settle()
    await adapter.destroy()
    answer()
    await settle()
    expect(spawn).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
    expect(failures).toEqual([])
  })
})

describe("discord.js adapter: events", () => {
  it("reports every READY with the bot's account, resumes and reconnects", () => {
    const { client, seen, ready } = setup()
    ready()
    client.emit(Events.ShardReconnecting, 0)
    client.emit(Events.ShardResume, 0, 3)
    ready("1234")
    expect(seen).toEqual([
      `ready ${SELF} user01`,
      "reconnecting",
      "resumed",
      `ready ${SELF} user01#1234`,
    ])
  })

  it("passes direct messages on as plain data, from a DM channel it never cached", () => {
    const { messages, dispatchMessage } = setup()
    dispatchMessage(
      rawMessage("21", {
        type: 19,
        attachments: [
          {
            id: "1",
            filename: "b.txt",
            url: "https://cdn/b",
            proxy_url: "",
            size: 1,
            content_type: "text/plain",
          },
        ],
      }),
    )
    expect(messages).toEqual([
      {
        id: "21",
        channelId: DM,
        guildId: null,
        server: null,
        kind: "reply",
        author: { id: ALLOWED, username: "user11", displayName: "User 11", bot: false },
        content: "message 21",
        attachments: [{ name: "b.txt", url: "https://cdn/b", size: 1, contentType: "text/plain" }],
        // A message's time is its snowflake's: Discord's epoch for this tiny test id.
        createdAt: 1420070400000,
      },
    ])
  })

  it("fails for good when Discord rejects the token at login, destroyed first", async () => {
    const { failures, destroy } = setup(async () => {
      const Rejection = DiscordjsError as unknown as new (code: string) => Error
      throw new Rejection(DiscordjsErrorCodes.TokenInvalid)
    })
    await settle()
    expect(destroy).toHaveBeenCalled()
    expect(failures).toEqual([{ retryable: false, reason: "Discord rejected the bot token" }])
  })

  it("fails retryably when Discord cannot be reached at login", async () => {
    const { failures } = setup(async () => {
      throw new Error("getaddrinfo ENOTFOUND discord.com")
    })
    await settle()
    expect(failures).toEqual([
      {
        retryable: true,
        reason: "Could not connect to Discord: getaddrinfo ENOTFOUND discord.com",
      },
    ])
  })

  it("fails for good, once, when the Gateway closes with an unrecoverable code", async () => {
    const { client, failures, destroy, seen, ready } = setup()
    client.emit(Events.ShardDisconnect, { code: 4004, reason: "", wasClean: true }, 0)
    client.emit(Events.ShardDisconnect, { code: 4014, reason: "", wasClean: true }, 0)
    await settle()
    ready()
    expect(destroy).toHaveBeenCalled()
    expect(failures).toEqual([
      { retryable: false, reason: "Discord rejected the bot token (4004)" },
    ])
    expect(seen).toEqual([])
  })

  it("stays failed for good when the login rejects after an unrecoverable close", async () => {
    let reject: (error: Error) => void = () => {}
    const { client, failures } = setup(
      () =>
        new Promise<string>((_, fail) => {
          reject = fail
        }),
    )
    client.emit(Events.ShardDisconnect, { code: 4014, reason: "", wasClean: true }, 0)
    reject(new Error("Used disallowed intents"))
    await settle()
    expect(failures).toEqual([
      {
        retryable: false,
        reason:
          "Discord refused the Gateway intents: a server channel home needs Message Content Intent and Server Members Intent; turn them on in the Developer Portal > Bot > Privileged Gateway Intents (4014)",
      },
    ])
  })

  it("emits nothing once destroyed", async () => {
    const { client, adapter, seen, messages, failures, dispatchMessage, ready } = setup()
    await adapter.destroy()
    ready()
    client.emit(Events.ShardDisconnect, { code: 4004, reason: "", wasClean: true }, 0)
    dispatchMessage(rawMessage("22"))
    await settle()
    expect([...seen, ...messages, ...failures]).toEqual([])
  })
})

describe("discord.js adapter: actions", () => {
  it("opens a DM, posts without pings, reacts and types there", async () => {
    const { adapter, requests } = setup()
    expect(await adapter.openDm(ALLOWED)).toBe(DM)
    await adapter.send(DM, { content: `hi <@${ALLOWED}> @everyone` })
    await adapter.react(DM, "21", "👀")
    await adapter.typing(DM)
    expect(requests.map(({ method, route }) => `${method} ${route}`)).toEqual([
      "POST /users/@me/channels",
      `POST /channels/${DM}/messages`,
      `PUT /channels/${DM}/messages/21/reactions/${encodeURIComponent("👀")}/@me`,
      `POST /channels/${DM}/typing`,
    ])
    expect(requests[0]?.body).toEqual({ recipient_id: ALLOWED })
    expect(requests[1]?.body).toMatchObject({
      content: `hi <@${ALLOWED}> @everyone`,
      allowed_mentions: { parse: [] },
    })
  })

  it("reads the messages after one, as plain data", async () => {
    const { adapter, requests } = setup()
    await adapter.openDm(ALLOWED)
    const page = await adapter.messagesAfter(DM, "10")
    expect(requests.at(-1)).toMatchObject({
      method: "GET",
      route: `/channels/${DM}/messages`,
      query: "after=10&limit=100",
    })
    expect(page.map((message) => [message.id, message.kind, message.attachments])).toEqual([
      ["12", "reply", []],
      ["11", "default", [{ name: "a.png", url: "https://cdn/a.png", size: 1, contentType: null }]],
      ["13", "other", []],
    ])
  })

  it("uploads files with a message, as a reply that survives a deleted original", async () => {
    const { adapter, requests } = setup()
    await adapter.openDm(ALLOWED)
    await adapter.send(DM, {
      content: "",
      files: [{ name: "r.txt", data: new TextEncoder().encode("hi") }],
      replyTo: "21",
    })
    const request = requests.at(-1)
    expect(request?.files?.map((file) => [file.name, String(file.data)])).toEqual([["r.txt", "hi"]])
    expect(request?.body).toMatchObject({
      message_reference: { message_id: "21", fail_if_not_exists: false },
      allowed_mentions: { parse: [] },
    })
    expect(JSON.stringify(request?.body)).not.toContain('"content"')
  })

  it("registers global DM-only slash commands once connected", async () => {
    const { adapter, requests, ready } = setup()
    await expect(adapter.registerCommands([])).rejects.toThrow("not connected")
    ready()
    await adapter.registerCommands([
      { name: "stop", description: "Stop", descriptionJa: "停止" },
      { name: "status", description: "Status" },
    ])
    expect(requests.at(-1)).toMatchObject({
      method: "PUT",
      route: `/applications/${APP}/commands`,
      body: [
        {
          type: 1,
          name: "stop",
          description: "Stop",
          description_localizations: { ja: "停止" },
          contexts: [1],
          integration_types: [0],
        },
        { type: 1, name: "status", description: "Status", contexts: [1], integration_types: [0] },
      ],
    })
  })

  it("registers the slash commands for servers in channel mode", async () => {
    const { adapter, requests, ready } = setup(undefined, "channel")
    ready()
    await adapter.registerCommands([{ name: "stop", description: "Stop" }])
    expect(requests.at(-1)?.body).toEqual([
      { type: 1, name: "stop", description: "Stop", contexts: [0], integration_types: [0] },
    ])
  })

  it("passes chat commands on and answers them, ephemeral when asked", async () => {
    const { client, invocations } = setup()
    const reply = vi.fn(async () => undefined)
    client.emit(Events.InteractionCreate, {
      isChatInputCommand: () => true,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      commandName: "status",
      user: { id: ALLOWED },
      guildId: null,
      locale: "ja",
      reply,
    } as never)
    client.emit(Events.InteractionCreate, {
      isChatInputCommand: () => false,
      isButton: () => false,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
    } as never)
    expect(
      invocations.map(({ name, userId, guildId, locale }) => ({ name, userId, guildId, locale })),
    ).toEqual([{ name: "status", userId: ALLOWED, guildId: null, locale: "ja" }])
    await invocations[0]?.respond({ content: "ok", ephemeral: true })
    expect(reply).toHaveBeenCalledWith({ content: "ok", allowedMentions: { parse: [] }, flags: 64 })
  })

  it("pins, edits and removes the bot's messages, telling which are gone or refused", async () => {
    const { client, adapter, requests } = setup()
    await adapter.openDm(ALLOWED)
    const rest = client.rest as unknown as Record<
      "put" | "patch" | "delete",
      (route: string) => Promise<unknown>
    >
    const refusal = (code: number) =>
      new DiscordAPIError({ code, message: "refused" }, code, 403, "PUT", "/", {})
    const answers: Record<string, unknown> = {
      [`/channels/${DM}/messages/pins/31`]: undefined,
      [`/channels/${DM}/messages/pins/32`]: refusal(
        RESTJSONErrorCodes.MaximumNumberOfPinsReachedForTheChannel,
      ),
      [`/channels/${DM}/messages/pins/33`]: refusal(RESTJSONErrorCodes.MissingPermissions),
      [`/channels/${DM}/messages/pins/34`]: refusal(RESTJSONErrorCodes.UnknownMessage),
      [`/channels/${DM}/messages/pins/35`]: new Error("network down"),
      [`/channels/${DM}/messages/41`]: refusal(RESTJSONErrorCodes.UnknownMessage),
      [`/channels/${DM}/messages/42`]: rawMessage("42"),
    }
    const answer = (method: string) => async (route: string) => {
      requests.push({ method, route })
      const value = answers[route]
      if (value instanceof Error) throw value
      return value
    }
    vi.spyOn(rest, "put").mockImplementation(answer("PUT"))
    vi.spyOn(rest, "patch").mockImplementation(answer("PATCH"))
    vi.spyOn(rest, "delete").mockImplementation(answer("DELETE"))
    expect(await adapter.pin(DM, "31")).toBe("pinned")
    expect(await adapter.pin(DM, "32")).toBe("full")
    expect(await adapter.pin(DM, "33")).toBe("forbidden")
    expect(await adapter.pin(DM, "34")).toBe("missing")
    await expect(adapter.pin(DM, "35")).rejects.toThrow("network down")
    const edit = { content: "", components: [] }
    expect(await adapter.edit(DM, "41", edit)).toBe("missing")
    expect(await adapter.edit(DM, "42", edit)).toBe("edited")
    expect(await adapter.remove(DM, "41")).toBe("missing")
    expect(await adapter.remove(DM, "42")).toBe("removed")
    expect(requests.slice(-4).map(({ method, route }) => `${method} ${route}`)).toEqual([
      `PATCH /channels/${DM}/messages/41`,
      `PATCH /channels/${DM}/messages/42`,
      `DELETE /channels/${DM}/messages/41`,
      `DELETE /channels/${DM}/messages/42`,
    ])
  })

  it("answers a command with embeds, without empty content", async () => {
    const { client, invocations } = setup()
    const reply = vi.fn(async () => undefined)
    client.emit(Events.InteractionCreate, {
      isChatInputCommand: () => true,
      commandName: "pending",
      user: { id: ALLOWED },
      guildId: null,
      locale: "en-US",
      reply,
    } as never)
    await invocations[0]?.respond({
      content: "",
      embeds: [{ title: "📋", description: "none" }],
      ephemeral: true,
    })
    expect(reply).toHaveBeenCalledWith({
      embeds: [{ title: "📋", description: "none" }],
      allowedMentions: { parse: [] },
      flags: 64,
    })
  })

  it("refuses a channel that is not a DM", async () => {
    const { client, adapter } = setup()
    const channels = client.channels as unknown as { _add(data: unknown): unknown }
    channels._add({ id: "500000000000000001", type: 0, guild_id: "600000000000000001", name: "x" })
    await expect(adapter.typing("500000000000000001")).rejects.toThrow("not a direct message")
  })
})
