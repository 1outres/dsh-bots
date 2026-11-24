import { describe, expect, it } from "vitest"
import { composeRows, withWebCapabilities } from "../src/host/preset/compose"
import type { BotTable } from "../src/host/registry"
import type { CredentialRecords } from "../src/host/secret-record"
import { createWebBridge } from "../src/host/web/bridge"
import { checkWebBackendDescriptor, createWebBackendCatalog } from "../src/host/web/catalog"
import { createWebPanel } from "../src/host/web/panel"
import { createWebState } from "../src/host/web/state"
import { capabilityStatus, servable } from "../src/host/web/status"
import { openWebSettingsStore } from "../src/host/web/store"
import { createWebTester } from "../src/host/web/tester"
import { createWebSecretVault, webVaultKey } from "../src/host/web/vault"
import { type BotWebSettings, DEFAULT_WEB_SETTINGS, webNeedsAttention } from "../src/shared/web"
import type { BotWebBackend } from "../src/web-contract"

function table<V>(initial: Record<string, V> = {}): BotTable<V> & { readonly map: Map<string, V> } {
  const map = new Map(Object.entries(initial))
  return {
    map,
    get: (key) => map.get(key),
    entries: () => map.entries(),
    put: async (key, value) => {
      map.set(key, value)
    },
    delete: async (key) => map.delete(key),
  }
}

function records(): CredentialRecords & {
  readonly store: Map<string, { kind: string; payload?: unknown }>
} {
  const store = new Map<string, { kind: string; payload?: unknown }>()
  return {
    store,
    readRecord: async (key) => store.get(key),
    async modifyRecord(key, mutate) {
      const next = await mutate()
      if (next !== undefined) store.set(key, next)
    },
    deleteRecord: async (key) => store.delete(key),
  }
}

const calls: string[] = []

function backend(overrides: Partial<BotWebBackend> = {}): BotWebBackend {
  return {
    id: "exa",
    name: { en: "Exa" },
    secrets: [{ key: "apiKey", label: { en: "Exa API key" } }],
    search: {
      placement: "host",
      run: async (request, call) => {
        calls.push(`search ${request.query} ${call.botId} ${call.secrets.apiKey}`)
        return { sources: [{ url: "https://a.test/" }], truncated: false }
      },
    },
    fetch: {
      placement: "host",
      run: async (request) => ({
        url: request.url,
        statusCode: 200,
        body: { kind: "text", content: "x" },
        truncated: false,
      }),
    },
    test: async ({ secrets }) =>
      secrets.apiKey === "good"
        ? { ok: true }
        : { ok: false, reason: "invalid-secret", message: "refused" },
    ...overrides,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

async function setup(stored: Record<string, BotWebSettings> = {}) {
  const webSettings = table(stored)
  const store = await openWebSettingsStore({ webSettings })
  const catalog = createWebBackendCatalog()
  const warnings: string[] = []
  const state = createWebState({ store, catalog, warn: (message) => warnings.push(message) })
  const credentials = records()
  const vault = createWebSecretVault(credentials)
  const panel = createWebPanel({
    state,
    store,
    tester: createWebTester({ deadline: () => new AbortController().signal }),
  })
  return { webSettings, store, catalog, state, credentials, vault, panel, warnings }
}

describe("web lookup status", () => {
  const input = (
    settings: Partial<BotWebSettings>,
    registered: BotWebBackend | undefined,
    keys?: string[],
  ) => ({
    settings: { ...DEFAULT_WEB_SETTINGS, ...settings },
    backend: registered,
    setKeys: keys === undefined ? undefined : new Set(keys),
  })

  it("decides disabled, unavailable, missing secrets, ready in that order", () => {
    expect(capabilityStatus(input({ search: false }, undefined), "search")).toEqual({
      state: "disabled",
    })
    expect(capabilityStatus(input({}, undefined, []), "search")).toEqual({
      state: "unavailable",
      backend: "exa",
      reason: "not-registered",
    })
    expect(capabilityStatus(input({}, backend({ fetch: undefined }), []), "fetch")).toEqual({
      state: "unavailable",
      backend: "exa",
      reason: "no-capability",
    })
    expect(capabilityStatus(input({}, backend()), "search")).toEqual({
      state: "unavailable",
      backend: "exa",
      reason: "no-credentials-service",
    })
    expect(capabilityStatus(input({}, backend(), []), "search")).toEqual({
      state: "missing-secrets",
      backend: "exa",
      keys: ["apiKey"],
    })
    expect(capabilityStatus(input({}, backend(), ["apiKey"]), "search")).toEqual({
      state: "ready",
      backend: "exa",
    })
  })

  it("serves what the backend has, whatever the settings say", () => {
    expect(servable(input({ search: false }, backend({ fetch: undefined })))).toEqual({
      backend: "exa",
      search: true,
      fetch: false,
    })
    expect(servable(input({}, undefined))).toEqual({ backend: "exa", search: false, fetch: false })
  })

  it("needs attention while a capability that is on cannot be used", () => {
    expect(
      webNeedsAttention({
        search: { state: "disabled" },
        fetch: { state: "ready", backend: "exa" },
      }),
    ).toBe(false)
    expect(
      webNeedsAttention({
        search: { state: "missing-secrets", backend: "exa", keys: ["apiKey"] },
        fetch: { state: "disabled" },
      }),
    ).toBe(true)
  })
})

describe("web settings store", () => {
  it("stores the defaults on the first start and only reads stored values after", async () => {
    const { webSettings, store } = await setup()
    expect(webSettings.map.get("global")).toEqual(DEFAULT_WEB_SETTINGS)
    await store.setEnabled("fetch", false)
    expect(webSettings.map.get("global")).toEqual({ ...DEFAULT_WEB_SETTINGS, fetch: false })
    const reopened = await openWebSettingsStore({ webSettings })
    expect(reopened.current().fetch).toBe(false)
  })
})

describe("web secret vault", () => {
  it("keeps one record per backend and drops it with its last secret", async () => {
    const credentials = records()
    const vault = createWebSecretVault(credentials)
    expect(webVaultKey("exa")).toBe("bot-core/web-exa")
    await vault.change("exa", "apiKey", "k1")
    expect(credentials.store.get("bot-core/web-exa")).toEqual({
      kind: "grant",
      payload: { version: 1, secrets: { apiKey: "k1" } },
    })
    expect(await vault.read("exa")).toEqual({ apiKey: "k1" })
    await vault.change("exa", "apiKey", undefined)
    expect(credentials.store.has("bot-core/web-exa")).toBe(false)
  })
})

describe("web backend catalog", () => {
  it.each([
    [{ id: "Exa" }, "lowercase"],
    [{ name: { en: "" } }, "English"],
    [{ secrets: [] }, "no secret"],
    [{ secrets: [{ key: "api-key", label: { en: "K" } }] }, "camelCase"],
    [
      {
        secrets: [
          { key: "a", label: { en: "A" } },
          { key: "a", label: { en: "B" } },
        ],
      },
      "twice",
    ],
    [{ search: undefined, fetch: undefined }, "neither search nor fetch"],
  ] as const)("refuses %j", (overrides, message) => {
    expect(() => checkWebBackendDescriptor(backend(overrides as Partial<BotWebBackend>))).toThrow(
      message,
    )
  })

  it("refuses a taken id until the first registration goes", () => {
    const catalog = createWebBackendCatalog()
    const off = catalog.register(backend())
    expect(() => catalog.register(backend())).toThrow("already registered")
    off()
    expect(catalog.list()).toEqual([])
  })
})

describe("botWeb panel", () => {
  it("is unavailable without DSH's credential store, then sets, tests and clears the key", async () => {
    const { catalog, state, vault, panel } = await setup()
    catalog.register(backend())
    expect(panel.view().status.search).toMatchObject({
      state: "unavailable",
      reason: "no-credentials-service",
    })
    await expect(panel.setSecret("apiKey", { op: "set", value: "x" })).rejects.toMatchObject({
      code: "bot-web/unavailable",
    })
    state.attachVault(vault)
    await settle()
    expect(panel.view().status.search).toMatchObject({ state: "missing-secrets" })
    await expect(panel.test()).rejects.toMatchObject({ code: "bot-web/missing-secrets" })
    const view = await panel.setSecret("apiKey", { op: "set", value: "  good  " })
    expect(view.backend?.secrets).toEqual([
      { key: "apiKey", label: { en: "Exa API key" }, set: true },
    ])
    expect(JSON.stringify(view)).not.toContain("good")
    expect(view.status.search).toEqual({ state: "ready", backend: "exa" })
    expect(await panel.test()).toEqual({ ok: true })
    await panel.setSecret("apiKey", { op: "set", value: "bad" })
    expect(await panel.test()).toEqual({ ok: false, reason: "invalid-secret", message: "refused" })
    expect((await panel.setSecret("apiKey", { op: "clear" })).status.fetch).toMatchObject({
      state: "missing-secrets",
    })
  })

  it("refuses malformed changes, unknown secrets, a missing backend and a capability it lacks", async () => {
    const { catalog, state, vault, panel } = await setup()
    state.attachVault(vault)
    await expect(panel.setSecret("apiKey", { op: "set", value: "k" })).rejects.toMatchObject({
      code: "bot-web/not-registered",
    })
    catalog.register(backend({ fetch: undefined }))
    await expect(panel.setSecret("apiKey", { op: "set", value: "  " })).rejects.toMatchObject({
      code: "gateway/bad-request",
    })
    await expect(panel.setSecret("other", { op: "set", value: "k" })).rejects.toMatchObject({
      code: "bot-web/unknown-secret",
    })
    await expect(panel.setEnabled("browse", true)).rejects.toMatchObject({
      code: "gateway/bad-request",
    })
    await panel.setEnabled("fetch", false)
    await expect(panel.setEnabled("fetch", true)).rejects.toMatchObject({
      code: "bot-web/no-capability",
    })
    expect((await panel.setEnabled("search", false)).settings).toEqual({
      backend: "exa",
      search: false,
      fetch: false,
    })
  })

  it("runs one connection test at a time", async () => {
    let release: () => void = () => {}
    const { catalog, state, vault, panel } = await setup()
    catalog.register(
      backend({
        test: () =>
          new Promise((resolve) => {
            release = () => resolve({ ok: true })
          }),
      }),
    )
    state.attachVault(vault)
    await panel.setSecret("apiKey", { op: "set", value: "k" })
    const first = panel.test()
    await settle()
    await expect(panel.test()).rejects.toMatchObject({ code: "bot-web/busy" })
    release()
    expect(await first).toEqual({ ok: true })
  })
})

describe("web bridge", () => {
  async function bridged() {
    const env = await setup()
    env.catalog.register(backend())
    env.state.attachVault(env.vault)
    let caller: string | undefined
    const bridge = createWebBridge({
      state: env.state,
      sealed: (botId, token) => botId === "b1" && token === "t1",
      caller: () => caller,
    })
    return { ...env, bridge, as: (agentId: string | undefined) => (caller = agentId) }
  }

  it("is ready only with every secret stored, and runs the backend with them", async () => {
    const { bridge, panel } = await bridged()
    expect(await bridge.ready("b1", "t1", "search")).toBe(false)
    expect(
      await bridge.search("b1", "t1", { query: "q" }, new AbortController().signal),
    ).toMatchObject({
      ok: false,
      refusal: { code: "WEB_PROVIDER_CREDENTIAL_MISSING" },
    })
    await panel.setSecret("apiKey", { op: "set", value: "k" })
    expect(await bridge.ready("b1", "t1", "search")).toBe(true)
    calls.length = 0
    expect(await bridge.search("b1", "t1", { query: "q" }, new AbortController().signal)).toEqual({
      ok: true,
      result: { sources: [{ url: "https://a.test/" }], truncated: false },
    })
    expect(calls).toEqual(["search q b1 k"])
  })

  it("refuses rows of revisions bot-core did not register", async () => {
    const { bridge, panel } = await bridged()
    await panel.setSecret("apiKey", { op: "set", value: "k" })
    expect(await bridge.ready("b1", "forged", "search")).toBe(false)
    expect(
      await bridge.fetch("b1", "forged", { url: "https://a.test/" }, new AbortController().signal),
    ).toMatchObject({
      ok: false,
      refusal: { code: "WEB_PROVIDER_UNAVAILABLE" },
    })
  })

  it("keeps the settings of a turn's start until the turn ends", async () => {
    const { bridge, panel, as } = await bridged()
    await panel.setSecret("apiKey", { op: "set", value: "k" })
    bridge.turnStarted("main")
    as("main")
    await panel.setEnabled("search", false)
    expect(await bridge.ready("b1", "t1", "search")).toBe(true)
    as("other")
    expect(await bridge.ready("b1", "t1", "search")).toBe(false)
    bridge.turnEnded("main")
    as("main")
    expect(await bridge.ready("b1", "t1", "search")).toBe(false)
    bridge.turnStarted("main")
    await panel.setEnabled("search", true)
    expect(await bridge.ready("b1", "t1", "search")).toBe(false)
  })
})

describe("tool-web composition", () => {
  const rows = [
    {
      id: "tool-web",
      name: "@deepseek-ai/dsh-tool-web",
      config: { fetch: true, searchTimeoutMs: 60000 },
    },
    {
      id: "group",
      name: "cordis:group",
      group: true,
      config: [{ id: "nested-web", name: "@deepseek-ai/dsh-tool-web", config: { search: false } }],
    },
    { id: "other", name: "@x/other" },
  ]

  it("offers a capability only when the template wants it and the web composition serves it", () => {
    expect(withWebCapabilities(rows, { backend: "exa", search: true, fetch: false })).toEqual([
      {
        id: "tool-web",
        name: "@deepseek-ai/dsh-tool-web",
        config: { fetch: false, search: true, searchTimeoutMs: 60000 },
      },
      {
        id: "group",
        name: "cordis:group",
        group: true,
        config: [
          {
            id: "nested-web",
            name: "@deepseek-ai/dsh-tool-web",
            config: { search: false, fetch: false },
          },
        ],
      },
      rows[2],
    ])
  })

  it.each([
    "@deepseek-ai/dsh-web",
    "@deepseek-ai/dsh-web-fetch-http",
    "@deepseek-ai/dsh-web-deepseek-api",
    "@deepseek-ai/dsh-web-search-deepseek",
    "@1outres/dsh-plugin-exa",
    "@1outres/dsh-bot-web",
  ])("refuses %s in a template", (name) => {
    const result = composeRows({
      botId: "b1",
      botName: "B",
      template: { id: "t", plugins: [{ id: "web", name }] },
      overlay: [],
      allowedHostTools: new Set(),
      web: { backend: "exa", search: true, fetch: true },
    })
    expect(result).toMatchObject({ ok: false })
    expect(!result.ok && result.problem).toContain(
      "provides the bot's web seam outside bot-core's settings",
    )
  })

  it("refuses a template row that isolates the web seam", () => {
    const result = composeRows({
      botId: "b1",
      botName: "B",
      template: {
        id: "t",
        plugins: [
          { id: "g", name: "cordis:group", group: true, isolate: { web: true }, config: [] },
        ],
      },
      overlay: [],
      allowedHostTools: new Set(),
      web: { backend: "exa", search: true, fetch: true },
    })
    expect(!result.ok && result.problem).toContain('isolates "web"')
  })
})
