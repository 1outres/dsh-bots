import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createArchivedViewStore } from "../src/client/archived-view"
import { createExpansionStore, parseExpansion } from "../src/client/expansion"

describe("createExpansionStore", () => {
  let storage: Map<string, string>
  beforeEach(() => {
    storage = new Map()
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, text: string) => storage.set(key, text),
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("reads the stored expansion and persists each change", () => {
    storage.set("dsh-bots:expanded", '{"a":true}')
    const expansion = createExpansionStore()
    expect(expansion.getSnapshot()).toEqual({ a: true })
    const listener = vi.fn()
    expansion.subscribe(listener)
    expansion.set("a", true)
    expect(listener).not.toHaveBeenCalled()
    expansion.set("b", false)
    expect(expansion.getSnapshot()).toEqual({ a: true, b: false })
    expect(storage.get("dsh-bots:expanded")).toBe('{"a":true,"b":false}')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("keeps which bots list their archived sessions under its own key", () => {
    const archived = createArchivedViewStore()
    archived.set("a", true)
    expect(storage.get("dsh-bots:archived-shown")).toBe('{"a":true}')
    expect(storage.has("dsh-bots:expanded")).toBe(false)
    expect(createArchivedViewStore().getSnapshot()).toEqual({ a: true })
  })

  it("starts empty and warns once on a corrupt value", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    storage.set("dsh-bots:expanded", '{"a":"yes"}')
    expect(createExpansionStore().getSnapshot()).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe("parseExpansion", () => {
  it("accepts an object of booleans only", () => {
    expect(parseExpansion({ a: false })).toEqual({ a: false })
    for (const value of [null, [], "x", { a: 1 }]) expect(() => parseExpansion(value)).toThrow()
  })
})
