import { describe, expect, it, vi } from "vitest"
import { createStore, derive } from "../src/client/observable"

describe("createStore", () => {
  it("notifies on a change, not on an equal value, and stops after unsubscribing", () => {
    const store = createStore(1)
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.set(1)
    expect(listener).not.toHaveBeenCalled()
    store.set(2)
    store.update((n) => n + 1)
    expect(store.getSnapshot()).toBe(3)
    expect(listener).toHaveBeenCalledTimes(2)
    off()
    store.set(4)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("compares with the given equality", () => {
    const store = createStore({ id: "a" }, (a, b) => a.id === b.id)
    const first = store.getSnapshot()
    const listener = vi.fn()
    store.subscribe(listener)
    store.set({ id: "a" })
    expect(store.getSnapshot()).toBe(first)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe("derive", () => {
  it("computes from the sources' snapshots and recomputes only when one changes", () => {
    const a = createStore(1)
    const b = createStore("x")
    const compute = vi.fn((n: number, s: string) => ({ label: `${s}${n}` }))
    const derived = derive([a, b], compute)
    const first = derived.getSnapshot()
    expect(first).toEqual({ label: "x1" })
    expect(derived.getSnapshot()).toBe(first)
    expect(compute).toHaveBeenCalledTimes(1)
    a.set(2)
    expect(derived.getSnapshot()).toEqual({ label: "x2" })
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it("notifies only when the derived value changes, and unsubscribes from every source", () => {
    const a = createStore(1)
    const b = createStore(10)
    const parity = derive([a, b], (n, m) => (n + m) % 2 === 0)
    const listener = vi.fn()
    const off = parity.subscribe(listener)
    a.set(3)
    expect(listener).not.toHaveBeenCalled()
    b.set(11)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(parity.getSnapshot()).toBe(true)
    off()
    a.set(4)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("keeps the previous snapshot while the given equality holds", () => {
    const a = createStore([1, 2])
    const sum = derive(
      [a],
      (list) => ({ total: list.reduce((x, y) => x + y, 0) }),
      (x, y) => x.total === y.total,
    )
    const first = sum.getSnapshot()
    a.set([2, 1])
    expect(sum.getSnapshot()).toBe(first)
  })
})
