import { describe, expect, it, vi } from "vitest"
import { createStore } from "../src/client/observable"
import {
  createSettingsFlow,
  dismissWhenGone,
  type SettingsTarget,
} from "../src/client/settings/flow"
import { createSettingsSections, type SettingsSection } from "../src/client/settings/sections"
import type { BotsSnapshot } from "../src/shared/bots"
import { bot, value } from "./support/client"

const section = (id: string, order: number): SettingsSection => ({
  id,
  order,
  label: () => id,
  icon: () => null,
  component: () => null,
})

describe("settings sections", () => {
  it("lists sections by order, then id, and removes them with their disposer", () => {
    const sections = createSettingsSections()
    const listener = vi.fn()
    sections.subscribe(listener)
    const offB = sections.register(section("b", 10))
    sections.register(section("a", 10))
    sections.register(section("first", 1))
    expect(sections.getSnapshot().map((item) => item.id)).toEqual(["first", "a", "b"])
    offB()
    offB()
    expect(sections.getSnapshot().map((item) => item.id)).toEqual(["first", "a"])
    expect(listener).toHaveBeenCalledTimes(4)
  })

  it("refuses a second section with the same id", () => {
    const sections = createSettingsSections()
    sections.register(section("a", 1))
    expect(() => sections.register(section("a", 2))).toThrow(/already registered/)
  })
})

function setup() {
  const sections = createSettingsSections()
  sections.register(section("general", 100))
  sections.register(section("channels", 200))
  sections.register(section("danger", 300))
  const store = createStore<SettingsTarget | null>(null)
  return { store, flow: createSettingsFlow(store, sections), sections }
}

describe("settings flow", () => {
  it("opens at the first section or a named one and its detail, and refuses an unknown one", () => {
    const { flow } = setup()
    flow.open("x")
    expect(flow.target.getSnapshot()).toEqual({
      botId: "x",
      section: "general",
      detail: null,
      nav: true,
    })
    flow.open("y", "danger")
    expect(flow.target.getSnapshot()).toEqual({
      botId: "y",
      section: "danger",
      detail: null,
      nav: false,
    })
    flow.open("y", "channels", "discord")
    expect(flow.target.getSnapshot()).toEqual({
      botId: "y",
      section: "channels",
      detail: "discord",
      nav: false,
    })
    expect(() => flow.open("y", "vm")).toThrow(/not registered/)
    expect(() => createSettingsFlow(createStore(null), createSettingsSections()).open("x")).toThrow(
      /no settings section/,
    )
  })

  it("moves through sections, details and the compact list freely while nothing is typed", () => {
    const { flow } = setup()
    flow.open("x")
    flow.select("channels")
    expect(flow.target.getSnapshot()).toMatchObject({ section: "channels", nav: false })
    flow.openDetail("discord")
    expect(flow.target.getSnapshot()?.detail).toBe("discord")
    flow.back()
    expect(flow.target.getSnapshot()?.detail).toBeNull()
    flow.openDetail("discord")
    flow.showNav()
    expect(flow.target.getSnapshot()).toMatchObject({
      section: "channels",
      detail: null,
      nav: true,
    })
    flow.close()
    expect(flow.target.getSnapshot()).toBeNull()
  })

  it("asks before any move while an editor holds typed text, and stays when told to", () => {
    const { flow } = setup()
    flow.open("x", "general")
    const release = flow.edits.hold()
    expect(flow.guard.getSnapshot()).toEqual({ pending: true, leaving: null })
    flow.select("channels")
    expect(flow.target.getSnapshot()?.section).toBe("general")
    expect(flow.guard.getSnapshot().leaving).toBe("move")
    flow.keepEditing()
    expect(flow.guard.getSnapshot()).toEqual({ pending: true, leaving: null })
    flow.openDetail("avatar")
    expect(flow.guard.getSnapshot().leaving).toBe("move")
    flow.keepEditing()
    flow.close()
    expect(flow.guard.getSnapshot().leaving).toBe("close")
    flow.select("general")
    expect(flow.guard.getSnapshot().leaving).toBeNull()
    release()
    expect(flow.guard.getSnapshot()).toEqual({ pending: false, leaving: null })
    flow.select("channels")
    expect(flow.target.getSnapshot()?.section).toBe("channels")
  })

  it("discards and takes the way out that waits; a released hold after it changes nothing", () => {
    const { flow } = setup()
    flow.open("x", "general")
    const release = flow.edits.hold()
    flow.select("danger")
    flow.discard()
    expect(flow.target.getSnapshot()).toMatchObject({ botId: "x", section: "danger" })
    expect(flow.guard.getSnapshot()).toEqual({ pending: false, leaving: null })
    release()
    expect(flow.guard.getSnapshot()).toEqual({ pending: false, leaving: null })
    flow.edits.hold()
    flow.close()
    flow.discard()
    expect(flow.target.getSnapshot()).toBeNull()
  })

  it("routes opening the same bot through the guard, and forgets typed text when the bot changes", () => {
    const { flow, store } = setup()
    flow.open("x", "general")
    flow.edits.hold()
    flow.open("x", "danger")
    expect(flow.guard.getSnapshot().leaving).toBe("move")
    store.set({ botId: "y", section: "general", detail: null, nav: false })
    expect(flow.guard.getSnapshot()).toEqual({ pending: false, leaving: null })
  })

  it("dismisses only the named bot, typed text dropped", () => {
    const { flow } = setup()
    flow.open("x")
    flow.edits.hold()
    flow.dismiss("y")
    expect(flow.target.getSnapshot()?.botId).toBe("x")
    flow.dismiss("x")
    expect(flow.target.getSnapshot()).toBeNull()
    expect(flow.guard.getSnapshot().pending).toBe(false)
  })
})

describe("dismissWhenGone", () => {
  it("closes the screen once its bot leaves the list, not while the list is unknown", () => {
    const { flow } = setup()
    const snapshot = value<BotsSnapshot | undefined>(undefined)
    const off = dismissWhenGone(flow, snapshot)
    flow.open("x")
    expect(flow.target.getSnapshot()).not.toBeNull()
    snapshot.set({ bots: [bot("x", "m1")], pending: [], preparingSessionIds: [] })
    expect(flow.target.getSnapshot()).not.toBeNull()
    snapshot.set({ bots: [], pending: [], preparingSessionIds: [] })
    expect(flow.target.getSnapshot()).toBeNull()
    flow.open("x")
    expect(flow.target.getSnapshot()).toBeNull()
    off()
  })
})

describe("settings confirmations", () => {
  const request = { title: "T", description: "D", confirm: "OK", tone: "danger" } as const
  const open = () => {
    const sections = createSettingsSections()
    sections.register(section("a", 1))
    sections.register(section("b", 2))
    const flow = createSettingsFlow(createStore<SettingsTarget | null>(null), sections)
    flow.open("x")
    return flow
  }

  it("shows a section's confirmation until the user answers it", async () => {
    const flow = open()
    const asked = flow.confirm(request)
    expect(flow.asking.getSnapshot()).toBe(request)
    flow.answer(true)
    await expect(asked).resolves.toBe(true)
    expect(flow.asking.getSnapshot()).toBeNull()
    const declined = flow.confirm(request)
    flow.answer(false)
    await expect(declined).resolves.toBe(false)
  })

  it("answers no when the screen closes, moves on or asks again", async () => {
    const flow = open()
    const first = flow.confirm(request)
    const second = flow.confirm(request)
    await expect(first).resolves.toBe(false)
    flow.select("b")
    await expect(second).resolves.toBe(false)
    expect(flow.asking.getSnapshot()).toBeNull()
    const third = flow.confirm(request)
    flow.close()
    await expect(third).resolves.toBe(false)
    await expect(flow.confirm(request)).resolves.toBe(false)
    expect(flow.asking.getSnapshot()).toBeNull()
  })
})
