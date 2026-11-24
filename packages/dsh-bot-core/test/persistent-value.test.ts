import { afterEach, describe, expect, it, vi } from "vitest"
import { createPersistentValue } from "../src/client/persistent-value"

const KEY = "dsh-bots:test"

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, text: string) => {
      data.set(key, text)
    },
  }
}

const parseCount = (stored: unknown): number => {
  if (typeof stored !== "number") throw new Error("not a number")
  return stored
}

const open = () => createPersistentValue({ key: KEY, parse: parseCount, initial: 7 })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("createPersistentValue", () => {
  it("reads the stored value, writes changes as JSON and notifies", () => {
    const storage = memoryStorage({ [KEY]: "3" })
    vi.stubGlobal("localStorage", storage)
    const value = open()
    expect(value.getSnapshot()).toBe(3)
    const listener = vi.fn()
    value.subscribe(listener)
    value.set(5)
    expect(storage.data.get(KEY)).toBe("5")
    expect(value.getSnapshot()).toBe(5)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("is the initial value without a stored one, silently", () => {
    vi.stubGlobal("localStorage", memoryStorage())
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(open().getSnapshot()).toBe(7)
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ["holds malformed JSON", () => memoryStorage({ [KEY]: "{oops" })],
    ["holds a value parse refuses", () => memoryStorage({ [KEY]: '"three"' })],
    ["is missing", () => undefined],
    [
      "throws",
      () => ({
        getItem: () => {
          throw new Error("denied")
        },
        setItem: () => {
          throw new Error("denied")
        },
      }),
    ],
  ])("is the initial value and warns once when storage %s", (_, storage) => {
    vi.stubGlobal("localStorage", storage())
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const value = open()
    expect(value.getSnapshot()).toBe(7)
    expect(value.getSnapshot()).toBe(7)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain(KEY)
  })

  it("keeps a value whose write fails for the page, warning once", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota")
      },
    })
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const value = open()
    value.set(1)
    value.set(2)
    expect(value.getSnapshot()).toBe(2)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
