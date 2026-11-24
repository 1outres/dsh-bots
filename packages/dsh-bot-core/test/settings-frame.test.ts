import { describe, expect, it, vi } from "vitest"
import { createStore } from "../src/client/observable"
import { openAlone } from "../src/client/settings-frame/exclusive"
import { createFrameFlow, type FrameTarget } from "../src/client/settings-frame/flow"
import { createSectionRegistry } from "../src/client/settings-frame/sections"
import { createScreenStack } from "../src/client/settings-frame/stack"

interface Item {
  readonly id: string
  readonly order: number
}

interface Target extends FrameTarget {
  readonly screen: string
}

const at = (screen: string, section: string | null, detail: string | null = null): Target => ({
  screen,
  section,
  detail,
  nav: false,
})

function setup(ids: readonly string[] = ["a", "b"]) {
  const sections = createSectionRegistry<Item>("test section")
  for (const [index, id] of ids.entries()) sections.register({ id, order: index })
  const store = createStore<Target | null>(null)
  const flow = createFrameFlow<Target>({
    store,
    sections,
    noun: "test section",
    sameScreen: (x, y) => x.screen === y.screen,
  })
  return { sections, store, flow }
}

describe("section registry", () => {
  it("orders by order then id, names its sections in errors, and disposes once", () => {
    const registry = createSectionRegistry<Item>("test section")
    const listener = vi.fn()
    registry.subscribe(listener)
    const off = registry.register({ id: "b", order: 1 })
    registry.register({ id: "a", order: 1 })
    registry.register({ id: "z", order: 0 })
    expect(registry.getSnapshot().map((item) => item.id)).toEqual(["z", "a", "b"])
    expect(() => registry.register({ id: "a", order: 5 })).toThrow(
      'bot-core: test section "a" is already registered',
    )
    off()
    off()
    expect(registry.getSnapshot().map((item) => item.id)).toEqual(["z", "a"])
    expect(listener).toHaveBeenCalledTimes(4)
  })
})

describe("frame flow", () => {
  it("resolves sections: the first when omitted, null while none is registered", () => {
    expect(setup().flow.sectionOf()).toBe("a")
    expect(setup().flow.sectionOf("b")).toBe("b")
    expect(setup([]).flow.sectionOf()).toBeNull()
    expect(() => setup().flow.sectionOf("x")).toThrow(
      'bot-core: test section "x" is not registered',
    )
  })

  it("moves within the same screen through the guard, and forgets typed text across screens", () => {
    const { flow, store } = setup()
    flow.open(at("one", "a"))
    flow.edits.hold()
    flow.open(at("one", "b", "detail"))
    expect(flow.guard.getSnapshot().leaving).toBe("move")
    expect(store.getSnapshot()).toEqual(at("one", "a"))
    flow.discard()
    expect(store.getSnapshot()).toEqual(at("one", "b", "detail"))
    flow.edits.hold()
    flow.open(at("two", "a"))
    expect(store.getSnapshot()).toEqual(at("two", "a"))
    expect(flow.guard.getSnapshot()).toEqual({ pending: false, leaving: null })
  })

  it("keeps one detail level: another detail replaces it, back returns to the first page", () => {
    const { flow, store } = setup()
    flow.open(at("one", "a"))
    flow.openDetail("x")
    flow.openDetail("y")
    expect(store.getSnapshot()).toEqual(at("one", "a", "y"))
    flow.back()
    expect(store.getSnapshot()).toEqual(at("one", "a"))
    flow.openDetail("x")
    flow.select("a")
    expect(store.getSnapshot()).toEqual(at("one", "a"))
  })

  it("holds while any editor holds, each release counted once", () => {
    const { flow } = setup()
    flow.open(at("one", "a"))
    const first = flow.edits.hold()
    const second = flow.edits.hold()
    first()
    first()
    expect(flow.guard.getSnapshot().pending).toBe(true)
    second()
    expect(flow.guard.getSnapshot().pending).toBe(false)
  })

  it("opens a screen with no section and closes it without asking", () => {
    const { flow, store } = setup([])
    flow.open(at("one", null))
    expect(store.getSnapshot()).toEqual(at("one", null))
    flow.close()
    expect(store.getSnapshot()).toBeNull()
  })

  it("dismisses and replaces at once, typed text dropped", () => {
    const { flow, store } = setup()
    flow.open(at("one", "a"))
    flow.edits.hold()
    flow.replace(at("one", "b"))
    expect(store.getSnapshot()).toEqual(at("one", "b"))
    flow.edits.hold()
    flow.dismiss()
    expect(store.getSnapshot()).toBeNull()
    expect(flow.guard.getSnapshot()).toEqual({ pending: false, leaving: null })
  })
})

describe("frame confirmations", () => {
  const request = { title: "T", description: "D", confirm: "Go", tone: "primary" } as const

  it("answer false when the page or the screen changes, or when replaced", async () => {
    const { flow } = setup()
    expect(await flow.confirm(request)).toBe(false)
    flow.open(at("one", "a"))
    const moved = flow.confirm(request)
    flow.openDetail("x")
    await expect(moved).resolves.toBe(false)
    const replaced = flow.confirm(request)
    const second = flow.confirm(request)
    await expect(replaced).resolves.toBe(false)
    expect(flow.asking.getSnapshot()).toEqual(request)
    flow.open(at("two", "b"))
    await expect(second).resolves.toBe(false)
    expect(flow.asking.getSnapshot()).toBeNull()
  })
})

describe("openAlone", () => {
  it("closes the other screens first, and opens only once they are closed", () => {
    const first = setup()
    const second = setup()
    first.flow.open(at("one", "a"))
    const open = vi.fn()
    openAlone([first.flow, second.flow], open)
    expect(first.store.getSnapshot()).toBeNull()
    expect(open).toHaveBeenCalledTimes(1)

    first.flow.open(at("one", "a"))
    first.flow.edits.hold()
    openAlone([first.flow], open)
    expect(first.flow.guard.getSnapshot().leaving).toBe("close")
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe("screen stack", () => {
  it("lists the open screens in the order they opened; closing one uncovers the one below", () => {
    const bot = createStore<object | null>(null)
    const global = createStore<object | null>({})
    const stack = createScreenStack([
      { id: "bot", target: bot },
      { id: "global", target: global },
    ])
    expect(stack.getSnapshot()).toEqual(["global"])
    global.set(null)
    bot.set({})
    global.set({})
    expect(stack.getSnapshot()).toEqual(["bot", "global"])
    bot.set({ moved: true })
    expect(stack.getSnapshot()).toEqual(["bot", "global"])
    global.set(null)
    expect(stack.getSnapshot()).toEqual(["bot"])
    stack.dispose()
    global.set({})
    expect(stack.getSnapshot()).toEqual(["bot"])
  })
})
