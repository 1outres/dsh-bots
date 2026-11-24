import { describe, expect, it } from "vitest"
import { createModelCatalog, type LlmRegistry } from "../src/host/models/catalog"
import type { BotModelsRecord } from "../src/host/models/domain"
import { createMainModelApplier } from "../src/host/models/main"
import { createBotModelStore } from "../src/host/models/store"
import type { BotTable } from "../src/host/registry"
import {
  DEFAULT_BOT_MODELS,
  MAX_DELEGATE_MODELS,
  parseModelsChange,
  sameModelChoice,
} from "../src/shared/models"

const light = { kind: "fixed", provider: "p", model: "light" } as const

function memoryTable<V>(rows = new Map<string, V>()): BotTable<V> {
  return {
    get: (key) => rows.get(key),
    entries: () => rows.entries(),
    put: async (key, value) => {
      rows.set(key, value)
    },
    delete: async (key) => rows.delete(key),
  }
}

describe("parseModelsChange", () => {
  it("takes known roles of their arity's shape", () => {
    expect(
      parseModelsChange({
        main: { kind: "fixed", provider: "p", model: "m", reasoningEffort: "high" },
        delegates: [light, { kind: "profile-default" }],
      }),
    ).toEqual({
      main: { kind: "fixed", provider: "p", model: "m", reasoningEffort: "high" },
      delegates: [light, { kind: "profile-default" }],
    })
    expect(parseModelsChange({})).toEqual({})
  })

  it("refuses anything else", () => {
    for (const change of [
      null,
      [],
      { helper: light },
      { main: [light] },
      { delegates: light },
      { main: { kind: "default" } },
      { main: { kind: "profile-default", provider: "p" } },
      { main: { kind: "fixed", provider: "", model: "m" } },
      { main: { kind: "fixed", provider: "p", model: "m", effort: "high" } },
      { delegates: [light, { ...light }] },
      {
        delegates: Array.from({ length: MAX_DELEGATE_MODELS + 1 }, (_, i) => ({
          ...light,
          model: `m${i}`,
        })),
      },
    ]) {
      expect(() => parseModelsChange(change), JSON.stringify(change)).toThrow()
    }
  })

  it("compares choices by route and effort", () => {
    expect(sameModelChoice(light, { ...light })).toBe(true)
    expect(sameModelChoice(light, { ...light, reasoningEffort: "high" })).toBe(false)
    expect(sameModelChoice({ kind: "profile-default" }, { kind: "profile-default" })).toBe(true)
    expect(sameModelChoice({ kind: "profile-default" }, light)).toBe(false)
  })
})

describe("the model store", () => {
  it("gives bots without a row the defaults and completes rows missing a role", async () => {
    const rows = new Map<string, BotModelsRecord>([["b", { roles: { main: light }, updatedAt: 1 }]])
    const store = createBotModelStore({ models: memoryTable(rows), now: () => 5 })
    expect(() => store.get("b")).toThrow(/lack utility, delegates/)
    await store.migrate(["a", "b"])
    expect(store.get("a")).toEqual({ models: DEFAULT_BOT_MODELS, mainPending: false })
    expect(rows.get("b")?.roles).toEqual({ ...DEFAULT_BOT_MODELS, main: light })
    expect(() => store.get("c")).toThrow()
  })

  it("marks a main change pending until the Main took that very choice", async () => {
    const store = createBotModelStore({ models: memoryTable(), now: () => 5 })
    await store.create("a", DEFAULT_BOT_MODELS)
    expect((await store.configure("a", { utility: light })).mainPending).toBe(false)
    expect((await store.configure("a", { main: light })).mainPending).toBe(true)
    await store.configure("a", { utility: { kind: "profile-default" } })
    expect(store.get("a").mainPending).toBe(true)
    await store.markApplied("a", { kind: "profile-default" })
    expect(store.get("a").mainPending).toBe(true)
    await store.markApplied("a", light)
    expect(store.get("a")).toEqual({
      models: { ...DEFAULT_BOT_MODELS, main: light },
      mainPending: false,
    })
  })

  it("forgets deleted bots", async () => {
    const store = createBotModelStore({ models: memoryTable(), now: () => 5 })
    await store.create("a", DEFAULT_BOT_MODELS)
    await store.create("b", DEFAULT_BOT_MODELS)
    await store.purge((botId) => botId === "a")
    expect([store.has("a"), store.has("b")]).toEqual([true, false])
  })
})

describe("the Main model applier", () => {
  it("records the pending main on a live Main only, and keeps it pending when DSH cannot run it", async () => {
    const store = createBotModelStore({ models: memoryTable(), now: () => 5 })
    await store.create("a", DEFAULT_BOT_MODELS)
    await store.configure("a", { main: light })
    const selected: unknown[] = []
    let live = false
    let runnable = false
    const warnings: string[] = []
    const applier = createMainModelApplier({
      store,
      mainOf: () => "m",
      agent: () =>
        live ? { model: { select: (selection) => selected.push(selection) } } : undefined,
      resolve: async (choice) => {
        if (!runnable) throw new Error("no such model")
        return choice.kind === "fixed"
          ? { provider: choice.provider, model: choice.model }
          : { provider: "p", model: "m" }
      },
      warn: (message) => warnings.push(message),
    })
    await applier.apply("a")
    expect(selected).toEqual([])
    live = true
    await applier.apply("a")
    expect(selected).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(store.get("a").mainPending).toBe(true)
    runnable = true
    await applier.apply("a")
    await applier.apply("a")
    expect(selected).toEqual([{ provider: "p", model: "light" }])
    expect(store.get("a").mainPending).toBe(false)
  })
})

describe("the model catalog", () => {
  const llm = (overrides: Partial<LlmRegistry> = {}): LlmRegistry => ({
    listProviders: () => [
      { id: "p", name: "P" },
      { id: "broken", name: "Broken" },
      { id: "empty", name: "Empty" },
    ],
    listModels: async (provider) => {
      if (provider === "broken") throw new Error("endpoint down")
      return provider === "p" ? [{ id: "m", name: "M" }] : []
    },
    resolveModelInfo: async () => ({ reasoning: { efforts: [{ id: "high", name: "High" }] } }),
    resolveCallConfig: async () => ({}),
    ...overrides,
  })

  it("lists providers with models, failures apart, and DSH's default", async () => {
    const catalog = createModelCatalog({
      llm: llm(),
      profileDefault: () => ({ provider: "p", model: "m" }),
    })
    expect(await catalog.read()).toEqual({
      profileDefault: { provider: "p", model: "m" },
      providers: [
        {
          id: "p",
          name: "P",
          models: [{ id: "m", name: "M", reasoning: { efforts: [{ id: "high", name: "High" }] } }],
        },
      ],
      failures: [{ id: "broken", name: "Broken", message: "endpoint down" }],
    })
  })

  it("checks a route as DSH's model picker does, then with resolveCallConfig", async () => {
    const catalog = createModelCatalog({
      llm: llm(),
      profileDefault: () => ({ provider: "p", model: "m" }),
    })
    const code = async (selection: { provider: string; model: string; reasoningEffort?: string }) =>
      (await catalog.check(selection))?.code
    expect(await code({ provider: "p", model: "m" })).toBeUndefined()
    expect(await code({ provider: "p", model: "m", reasoningEffort: "high" })).toBeUndefined()
    expect(await code({ provider: "x", model: "m" })).toBe("bot-models/unknown-provider")
    expect(await code({ provider: "broken", model: "m" })).toBe("bot-models/catalog-failed")
    expect(await code({ provider: "p", model: "n" })).toBe("bot-models/unknown-model")
    expect(await code({ provider: "p", model: "m", reasoningEffort: "low" })).toBe(
      "bot-models/invalid-effort",
    )
    const strict = createModelCatalog({
      llm: llm({
        resolveCallConfig: async () => {
          throw new Error("refused")
        },
      }),
      profileDefault: () => ({ provider: "p", model: "m" }),
    })
    expect(await strict.check({ provider: "p", model: "m" })).toEqual({
      code: "bot-models/rejected",
      message: "refused",
    })
  })
})
