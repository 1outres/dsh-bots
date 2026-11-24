import { describe, expect, it } from "vitest"
import { defineConnectorTool } from "../src/connector-contract"
import type { BotConnectionProvider, BotConnector, BotConnectorRun } from "../src/contract"
import { createOAuthClients } from "../src/host/connections/clients"
import type { ConnectionRecord } from "../src/host/connections/domain"
import type { OAuthFetch } from "../src/host/connections/oauth"
import { createConnectionPanel } from "../src/host/connections/panel"
import { createConnectionProviders } from "../src/host/connections/providers"
import { createConnectionServices } from "../src/host/connections/services"
import { createConnectionSignIn } from "../src/host/connections/signin"
import { createConnectionTokens } from "../src/host/connections/tokens"
import {
  type ConnectionCredentialRecords,
  createConnectionVault,
} from "../src/host/connections/vault"
import { createConnectorCatalog } from "../src/host/connectors/catalog"
import { createConnectorToolSurface } from "../src/host/connectors/tools"
import { brokerSetup, settle } from "./connectors-support"

const OWNER = { kind: "owner" }

/** A token endpoint in memory: codes it issued, refresh tokens it honours, and every request. */
function fakeTokenEndpoint() {
  const requests: { url: string; form: Record<string, string> }[] = []
  const codes = new Map<string, { subject: string; scope: string }>()
  const refreshTokens = new Map<string, string>()
  const revoked = new Set<string>()
  let issued = 0
  const reply = (status: number, body: unknown) => ({
    status,
    text: async () => JSON.stringify(body),
  })
  const fetch: OAuthFetch = async (url, init) => {
    const form = Object.fromEntries(new URLSearchParams(init.body))
    requests.push({ url, form })
    if (url.endsWith("/revoke")) {
      revoked.add(form.token ?? "")
      return reply(200, {})
    }
    if (form.client_secret !== "s3cret") return reply(401, { error: "invalid_client" })
    if (form.grant_type === "authorization_code") {
      const code = codes.get(form.code ?? "")
      if (code === undefined) return reply(400, { error: "invalid_grant" })
      codes.delete(form.code ?? "")
      const refresh = `refresh-${++issued}`
      refreshTokens.set(refresh, code.subject)
      return reply(200, {
        access_token: `access-${issued}`,
        expires_in: 3600,
        refresh_token: refresh,
        scope: code.scope,
      })
    }
    const subject = refreshTokens.get(form.refresh_token ?? "")
    if (subject === undefined || revoked.has(form.refresh_token ?? "")) {
      return reply(400, {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      })
    }
    return reply(200, { access_token: `access-${++issued}`, expires_in: 3600 })
  }
  return { fetch, requests, codes, refreshTokens, revoked }
}

function memoryCredentials(): ConnectionCredentialRecords & { records: Map<string, unknown> } {
  const records = new Map<string, unknown>()
  return {
    records,
    async readRecord(key) {
      return records.get(key) as { kind: string; payload?: unknown } | undefined
    },
    async modifyRecord(key, mutate) {
      const next = await mutate()
      if (next !== undefined) records.set(key, next)
      return next
    },
    async deleteRecord(key) {
      records.delete(key)
    },
  }
}

const PROVIDER: BotConnectionProvider = {
  id: "acme",
  name: "Acme",
  oauth: {
    authorizationEndpoint: "https://accounts.acme.test/authorize",
    tokenEndpoint: "https://oauth.acme.test/token",
    revocationEndpoint: "https://oauth.acme.test/revoke",
    identityScopes: ["openid", "email"],
    authorizationParameters: { access_type: "offline", prompt: "consent" },
  },
  async identify(accessToken) {
    const subject = identities.get(accessToken)
    if (subject === undefined) throw new Error("unknown token")
    return { subject, email: `${subject}@acme.test` }
  },
}

/** Which subject each access token the fake endpoint issues belongs to (set by the tests). */
const identities = new Map<string, string>()

function mailbox(log: string[] = []): BotConnector {
  return {
    id: "inbox",
    name: "Inbox",
    sessions: "main",
    connections: { provider: "acme", scopes: ["mail.read"] },
    tools: [
      defineConnectorTool({
        name: "read",
        description: "Read a message.",
        parameters: { id: { type: "string", required: true } },
        permission: "allow",
        preview: (args) => ({ title: `Read ${args.id}?`, fields: [] }),
        async execute(args, run: BotConnectorRun) {
          log.push(
            `read ${args.id} as ${run.connection?.info.account.email} ${await run.connection?.accessToken()}`,
          )
          return { data: { id: args.id } }
        },
      }),
      defineConnectorTool({
        name: "send",
        description: "Send a message.",
        parameters: { to: { type: "string", required: true } },
        permission: "ask",
        ask: { waitMs: 0, ttlMs: 60_000 },
        preview: (args) => ({ title: "Send?", fields: [{ label: "To", value: args.to }] }),
        async execute(args, run: BotConnectorRun) {
          log.push(`send ${args.to} as ${run.connection?.info.account.email} (${run.trigger.kind})`)
          return { data: { sent: true } }
        },
      }),
    ],
  }
}

function signInSetup() {
  const setup = brokerSetup()
  const endpoint = fakeTokenEndpoint()
  const credentials = memoryCredentials()
  const vault = createConnectionVault(credentials)
  const providers = createConnectionProviders()
  providers.register(PROVIDER)
  const connector = mailbox(setup.log)
  setup.catalog.register(connector)
  const services = createConnectionServices(setup.catalog)
  const clients = createOAuthClients({ store: setup.connectionStore, vault, warn: () => {} })
  const tokens = createConnectionTokens({
    store: setup.connectionStore,
    vault,
    providers,
    client: (provider) => clients.credentials(provider),
    fetch: endpoint.fetch,
    now: setup.clock.now,
    deadline: () => new AbortController().signal,
  })
  let secrets = 0
  let ids = 0
  const signIn = createConnectionSignIn({
    providers,
    services,
    store: setup.connectionStore,
    vault,
    tokens,
    client: (provider) => clients.credentials(provider),
    exists: (botId) => setup.bots.has(botId),
    fetch: endpoint.fetch,
    secret: () => `secret-${++secrets}`,
    challenge: (verifier) => `challenge-of-${verifier}`,
    newConnectionId: () => `conn-${++ids}`,
    newAttemptId: () => `att-${++ids}`,
    now: setup.clock.now,
    later: setup.clock.later,
    deadline: () => new AbortController().signal,
  })
  const panel = createConnectionPanel({
    providers,
    services,
    store: setup.connectionStore,
    clients,
    signIn,
    vault,
    tokens,
    fetch: endpoint.fetch,
    deadline: () => new AbortController().signal,
    exists: (botId) => setup.bots.has(botId),
  })
  /** Sign an account in through the whole flow, as the browser would. */
  const connect = async (subject: string, request: Record<string, unknown> = {}) => {
    const authorization = await panel.authorize(OWNER, {
      provider: "acme",
      services: ["inbox"],
      origin: "https://dsh.example",
      ...request,
    })
    const url = new URL(authorization.url)
    const code = `code-${subject}-${endpoint.codes.size}`
    endpoint.codes.set(code, { subject, scope: "openid email mail.read" })
    identities.set(`access-${endpoint.refreshTokens.size + 1}`, subject)
    return {
      url,
      outcome: await signIn.callback(
        new URLSearchParams({ state: url.searchParams.get("state") ?? "", code }),
      ),
    }
  }
  return {
    ...setup,
    endpoint,
    credentials,
    vault,
    providers,
    clients,
    tokens,
    signIn,
    panel,
    connector,
    connect,
  }
}

const configured = async (setup: ReturnType<typeof signInSetup>) => {
  await setup.panel.configureClient(OWNER, "acme", {
    clientId: "client-1",
    clientSecret: { op: "set", value: "s3cret" },
  })
}

describe("connection sign-in", () => {
  it("refuses to start before the provider's OAuth client is set up, and refuses non-owners", async () => {
    const setup = signInSetup()
    await expect(
      setup.panel.authorize(OWNER, {
        provider: "acme",
        services: ["inbox"],
        origin: "https://dsh.example",
      }),
    ).rejects.toThrow("set up the Acme OAuth client")
    await expect(
      setup.panel.authorize(
        { kind: "viewer" },
        { provider: "acme", services: ["inbox"], origin: "https://dsh.example" },
      ),
    ).rejects.toThrow("only the owner")
    await expect(
      setup.panel.configureClient(undefined, "acme", {
        clientId: "x",
        clientSecret: { op: "keep" },
      }),
    ).rejects.toThrow("only the owner")
  })

  it("sends the browser to the provider with state, PKCE S256, offline access and every scope", async () => {
    const setup = signInSetup()
    await configured(setup)
    const authorization = await setup.panel.authorize(OWNER, {
      provider: "acme",
      services: ["inbox"],
      origin: "https://dsh.example",
    })
    const url = new URL(authorization.url)
    expect(url.origin + url.pathname).toBe("https://accounts.acme.test/authorize")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      access_type: "offline",
      prompt: "consent",
      response_type: "code",
      client_id: "client-1",
      redirect_uri: "https://dsh.example/bot-core/oauth/callback",
      scope: "openid email mail.read",
      state: "secret-1",
      code_challenge: "challenge-of-secret-2",
      code_challenge_method: "S256",
    })
    expect(authorization.redirectUri).toBe("https://dsh.example/bot-core/oauth/callback")
    await expect(
      setup.panel.authorize(OWNER, {
        provider: "acme",
        services: ["inbox"],
        origin: "https://dsh.example/x",
      }),
    ).rejects.toThrow("origin must be an http(s) origin")
    await expect(
      setup.panel.authorize(OWNER, {
        provider: "acme",
        services: ["other"],
        origin: "https://dsh.example",
      }),
    ).rejects.toThrow('"other" is not a connector of Acme')
  })

  it("exchanges the code with the verifier and the secret, keeps the refresh token on the Host and assigns the bot", async () => {
    const setup = signInSetup()
    await configured(setup)
    const { outcome } = await setup.connect("ann", { botId: "b1", label: "Work" })
    expect(outcome.ok).toBe(true)
    const exchange = setup.endpoint.requests.find(
      (request) => request.form.grant_type === "authorization_code",
    )
    expect(exchange?.form).toMatchObject({
      code_verifier: "secret-2",
      client_id: "client-1",
      client_secret: "s3cret",
      redirect_uri: "https://dsh.example/bot-core/oauth/callback",
    })
    const [connection] = setup.connectionStore.list()
    expect(connection).toMatchObject({
      provider: "acme",
      label: "Work",
      account: { subject: "ann", email: "ann@acme.test" },
      services: ["inbox"],
      status: "active",
      issuer: "https://oauth.acme.test/token",
    })
    expect(setup.connectionStore.isAssigned("b1", connection?.id ?? "")).toBe(true)
    expect(setup.credentials.records.get(`bot-core/connection-${connection?.id}`)).toMatchObject({
      kind: "grant",
      payload: { version: 1, refreshToken: "refresh-1", subject: "ann" },
    })
    const snapshot = setup.panel.snapshot()
    expect(JSON.stringify(snapshot)).not.toContain("refresh-1")
    expect(JSON.stringify(snapshot)).not.toContain("s3cret")
    expect(snapshot.attempts[0]?.state).toMatchObject({
      kind: "connected",
      connectionId: connection?.id,
    })
  })

  it("answers an unknown or reused state, and a provider error, without touching anything", async () => {
    const setup = signInSetup()
    await configured(setup)
    const { url } = await setup.connect("ann")
    const replay = await setup.signIn.callback(
      new URLSearchParams({ state: url.searchParams.get("state") ?? "", code: "again" }),
    )
    expect(replay).toMatchObject({ ok: false, status: 400 })
    expect(
      await setup.signIn.callback(new URLSearchParams({ state: "forged", code: "x" })),
    ).toMatchObject({
      ok: false,
      status: 400,
    })
    const authorization = await setup.panel.authorize(OWNER, {
      provider: "acme",
      services: ["inbox"],
      origin: "https://dsh.example",
    })
    const state = new URL(authorization.url).searchParams.get("state") ?? ""
    const denied = await setup.signIn.callback(
      new URLSearchParams({ state, error: "access_denied" }),
    )
    expect(denied).toMatchObject({ ok: false, reason: expect.stringContaining("access_denied") })
    expect(setup.connectionStore.list()).toHaveLength(1)
  })

  it("expires an attempt nobody finished", async () => {
    const setup = signInSetup()
    await configured(setup)
    const authorization = await setup.panel.authorize(OWNER, {
      provider: "acme",
      services: ["inbox"],
      origin: "https://dsh.example",
    })
    await setup.clock.advance(10 * 60_000 + 1)
    const state = new URL(authorization.url).searchParams.get("state") ?? ""
    expect(await setup.signIn.callback(new URLSearchParams({ state, code: "c" }))).toMatchObject({
      ok: false,
    })
  })

  it("signs the same account in again into the same connection, and refuses another account for it", async () => {
    const setup = signInSetup()
    await configured(setup)
    await setup.connect("ann")
    const [first] = setup.connectionStore.list()
    await setup.connectionStore.setStatus(first?.id ?? "", "needs-reauth", "invalid_grant")
    const again = await setup.connect("ann", { connectionId: first?.id })
    expect(again.url.searchParams.get("login_hint")).toBe("ann@acme.test")
    expect(again.outcome.ok).toBe(true)
    expect(setup.connectionStore.list()).toHaveLength(1)
    expect(setup.connectionStore.get(first?.id ?? "")?.status).toBe("active")
    const other = await setup.connect("bob", { connectionId: first?.id })
    expect(other.outcome).toMatchObject({
      ok: false,
      reason: expect.stringContaining("you signed in as bob@acme.test"),
    })
  })
})

describe("connection tokens", () => {
  it("refreshes once at a time, keeps the token until it nearly expires, and marks a refused refresh for signing in again", async () => {
    const setup = signInSetup()
    await configured(setup)
    await setup.connect("ann")
    const [connection] = setup.connectionStore.list()
    const id = connection?.id ?? ""
    expect(await setup.tokens.accessToken(id)).toBe("access-1")
    await setup.clock.advance(3600_000)
    const [a, b] = await Promise.all([setup.tokens.accessToken(id), setup.tokens.accessToken(id)])
    expect(a).toBe(b)
    expect(
      setup.endpoint.requests.filter((request) => request.form.grant_type === "refresh_token"),
    ).toHaveLength(1)
    setup.endpoint.revoked.add("refresh-1")
    await expect(setup.tokens.accessToken(id, { refresh: true })).rejects.toThrow("signed in again")
    expect(setup.connectionStore.get(id)).toMatchObject({ status: "needs-reauth" })
    await expect(setup.tokens.accessToken(id)).rejects.toThrow("needs-reauth")
  })

  it("never sends a refresh token to another token endpoint than the one that issued it", async () => {
    const setup = signInSetup()
    await configured(setup)
    await setup.connect("ann")
    const [connection] = setup.connectionStore.list()
    await setup.connectionStore.put({
      ...(connection as ConnectionRecord),
      issuer: "https://evil.test/token",
    })
    setup.tokens.forget(connection?.id ?? "")
    await expect(setup.tokens.accessToken(connection?.id ?? "")).rejects.toThrow(
      "signed in at https://evil.test/token",
    )
    expect(setup.endpoint.requests.some((request) => request.url.includes("evil"))).toBe(false)
  })
})

describe("connector accounts", () => {
  it("resolves the account a call names, runs as it, and shows its email in an Ask preview", async () => {
    const setup = signInSetup()
    await configured(setup)
    await setup.connect("ann", { botId: "b1", label: "Work" })
    await setup.enable(setup.connector, ["b1"])
    await settle()
    expect(setup.readiness.state("b1", "inbox").state).toBe("ready")
    const call = (tool: string, args: Record<string, string>) => ({
      botId: "b1",
      sessionId: "main-1",
      connectorId: "inbox",
      tool,
      args,
    })
    const signal = new AbortController().signal
    await setup.broker.call(call("read", { account: "WORK", id: "m1" }), signal)
    await setup.broker.call(call("read", { account: "ann@acme.test", id: "m2" }), signal)
    const id = setup.connectionStore.list()[0]?.id
    expect(setup.log.filter((line) => line.startsWith("read"))).toEqual([
      `read m1 as ann@acme.test token-${id}`,
      `read m2 as ann@acme.test token-${id}`,
    ])
    await expect(
      setup.broker.call(call("read", { account: "nobody", id: "m" }), signal),
    ).rejects.toThrow('no account "nobody"')
    await expect(setup.broker.call(call("read", { id: "m" }), signal)).rejects.toThrow("account")
    const reply = await setup.broker.call(call("send", { account: "Work", to: "x@y.test" }), signal)
    expect(reply.data).toMatchObject({ status: "awaiting-approval" })
    const [action] = setup.ledger.list("b1")
    expect(action?.preview.fields[0]).toEqual({ label: "Account", value: "Work <ann@acme.test>" })
    expect(action?.connectionId).toBe(setup.connectionStore.list()[0]?.id)
    await setup.broker.recordDecision({
      botId: "b1",
      actionId: action?.id ?? "",
      decision: "approve",
      origin: { kind: "web" },
    })
    await settle()
    expect(setup.log).toContain("send x@y.test as ann@acme.test (approval)")
  })

  it("fails an approved action whose account was unassigned meanwhile", async () => {
    const setup = signInSetup()
    await configured(setup)
    await setup.connect("ann", { botId: "b1" })
    await setup.connect("bob", { botId: "b1" })
    await setup.enable(setup.connector, ["b1"])
    await settle()
    const signal = new AbortController().signal
    await setup.broker.call(
      {
        botId: "b1",
        sessionId: "main-1",
        connectorId: "inbox",
        tool: "send",
        args: { account: "ann@acme.test", to: "z" },
      },
      signal,
    )
    const [action] = setup.ledger.list("b1")
    const ann = setup.connectionStore.byAccount("acme", "ann")
    await setup.connectionStore.assign("b1", ann?.id ?? "", false)
    await setup.broker.recordDecision({
      botId: "b1",
      actionId: action?.id ?? "",
      decision: "approve",
      origin: { kind: "web" },
    })
    await settle()
    expect(setup.ledger.get(action?.id ?? "")?.status).toMatchObject({
      state: "failed",
      reason: expect.stringContaining("no longer assigned"),
    })
    expect(setup.log.some((line) => line.startsWith("send"))).toBe(false)
  })

  it("is unavailable without a usable account, and lets a bot override a tool for one account only", async () => {
    const setup = signInSetup()
    await configured(setup)
    await setup.enable(setup.connector, ["b1"])
    await settle()
    expect(setup.readiness.state("b1", "inbox")).toMatchObject({
      state: "unavailable",
      reason: expect.stringContaining("connect an account"),
    })
    await setup.connect("ann", { botId: "b1" })
    await setup.connect("bob", { botId: "b1" })
    await settle()
    expect(setup.readiness.state("b1", "inbox").state).toBe("ready")
    const bob = setup.connectionStore.byAccount("acme", "bob")?.id ?? ""
    await setup.permissions.set("b1", {
      connectorId: "inbox",
      tool: "read",
      permission: "disallow",
      connectionId: bob,
    })
    const signal = new AbortController().signal
    await expect(
      setup.broker.call(
        {
          botId: "b1",
          sessionId: "m",
          connectorId: "inbox",
          tool: "read",
          args: { account: "bob@acme.test", id: "1" },
        },
        signal,
      ),
    ).rejects.toThrow("not available to this bot as bob@acme.test")
    await setup.broker.call(
      {
        botId: "b1",
        sessionId: "m",
        connectorId: "inbox",
        tool: "read",
        args: { account: "ann@acme.test", id: "1" },
      },
      signal,
    )
    const surface = createConnectorToolSurface(setup)
    expect(surface.tools("b1").map((tool) => tool.name)).toEqual([
      "inbox_read",
      "inbox_send",
      "inbox_accounts",
      "connector_pending_list",
      "connector_pending_cancel",
    ])
    const listed = setup.permissions.list("b1", () => [
      setup.connectionStore.byAccount("acme", "ann")?.id ?? "",
      bob,
    ])
    expect(listed.find((entry) => entry.tool === "read")?.accounts).toEqual([
      { connectionId: setup.connectionStore.byAccount("acme", "ann")?.id, effective: "allow" },
      { connectionId: bob, override: "disallow", effective: "disallow" },
    ])
    const accounts = setup.own.accounts("b1", "inbox")
    expect(accounts.text).toContain("- ann@acme.test")
  })

  it("disconnects: revokes at the provider, forgets the secret, the connection and its assignments", async () => {
    const setup = signInSetup()
    await configured(setup)
    await setup.connect("ann", { botId: "b1" })
    const [connection] = setup.connectionStore.list()
    const removal = await setup.panel.disconnect(OWNER, connection?.id ?? "")
    expect(removal).toEqual({ connectionId: connection?.id, revoked: true })
    expect(setup.endpoint.revoked.has("refresh-1")).toBe(true)
    expect(setup.credentials.records.has(`bot-core/connection-${connection?.id}`)).toBe(false)
    expect(setup.connectionStore.list()).toEqual([])
    expect(setup.connectionStore.assigned("b1")).toEqual([])
  })
})

describe("connector catalog with connections", () => {
  it("adds the account argument and refuses tools that take bot-core's names", () => {
    const catalog = createConnectorCatalog()
    catalog.register(mailbox())
    const entry = catalog.tool("inbox", "read")
    expect(entry?.schema).toMatchObject({
      required: ["account", "id"],
      properties: { account: { type: "string" } },
    })
    expect(entry?.check({ id: "x" })).not.toEqual([])
    expect(entry?.split({ account: "a", id: "x" })).toEqual({ account: "a", own: { id: "x" } })
    const clash = mailbox()
    expect(() =>
      createConnectorCatalog().register({
        ...clash,
        tools: [
          defineConnectorTool({
            name: "accounts",
            description: "Mine.",
            parameters: {},
            permission: "allow",
            preview: () => ({ title: "x", fields: [] }),
            execute: async () => ({}),
          }),
        ],
      }),
    ).toThrow("bot-core's own")
    expect(() =>
      createConnectorCatalog().register({
        ...clash,
        tools: [
          defineConnectorTool({
            name: "own",
            description: "Mine.",
            parameters: { account: { type: "string" } },
            permission: "allow",
            preview: () => ({ title: "x", fields: [] }),
            execute: async () => ({}),
          }),
        ],
      }),
    ).toThrow('declares "account"')
    expect(() =>
      createConnectorCatalog().register({
        ...clash,
        connections: undefined,
        events: {
          kinds: [{ kind: "x", label: { en: "X" } }],
          delivery: "notify",
          intervalMs: 60_000,
          poll: async () => ({ events: [], cursor: null }),
        },
      }),
    ).toThrow("events but no connections")
  })
})
