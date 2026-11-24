import { describe, expect, it } from "vitest"
import { MAIN_DEFAULTS_KEY, type StoredMainSettings } from "../src/host/mains/domain"
import { openMainStore } from "../src/host/mains/store"
import { createMemoryFlush, MEMORY_FLUSH_ID } from "../src/host/notes/flush"
import { memoryFlushPrompt } from "../src/host/notes/texts"
import {
  DEFAULT_MAIN_ROTATION,
  effectiveMainRotation,
  validateMainRotationOverride,
  validateMainRotationSettings,
} from "../src/shared/mains"
import { memoryTable } from "./channels-support"
import { MINUTE, mainControllerSetup, NOON } from "./mains-support"

async function setup() {
  const context = await mainControllerSetup()
  const { store, preparations } = context
  preparations.register(
    createMemoryFlush({
      enabled: (botId) =>
        effectiveMainRotation(store.defaults(), store.override(botId)).memoryFlush.enabled,
    }),
  )
  return context
}

const COMPACT_TURN = "turn m1 Memory write-out before compaction"
const ROTATE_TURN = "turn m1 Memory write-out before a new Main"

describe("the memory write-out before a Main maintenance", () => {
  it("asks the Main for one write-out turn before an idle compaction", async () => {
    const { clock, agents, log, prompts, controller } = await setup()
    agents.set("m1", { status: "idle", inboxEmpty: true, usagePercent: 70 })
    controller.turnEnded("m1", NOON)
    await clock.advance(11 * MINUTE)
    expect(log).toEqual([COMPACT_TURN, "compact m1"])
    expect(prompts).toEqual([memoryFlushPrompt({ kind: "compact" })])
  })

  it("asks for it before every new Main: daily, by the owner, and before a held input", async () => {
    const { clock, log, controller, store } = await setup()
    controller.turnEnded("m1", NOON)
    await clock.advance(17 * 60 * MINUTE)
    expect(log).toEqual([
      ROTATE_TURN,
      "create b Bot",
      "replace m1 m2 daily",
      "changed b",
      "archive m1",
    ])

    log.length = 0
    controller.turnEnded("m2", clock.now())
    await clock.advance(11 * MINUTE)
    expect(await controller.startNew("b")).toEqual({ outcome: "started", sessionId: "m3" })
    expect(log[0]).toBe("turn m2 Memory write-out before a new Main")
    expect(log[2]).toBe("replace m2 m3 owner")

    log.length = 0
    await store.setDefaults({ ...DEFAULT_MAIN_ROTATION, daily: { enabled: false, time: "04:00" } })
    controller.turnEnded("m3", clock.now())
    await clock.advance(6 * 60 * MINUTE)
    expect(await controller.admit("b", async (sessionId) => sessionId)).toBe("m4")
    expect(log.slice(0, 3)).toEqual([
      "turn m3 Memory write-out before a new Main",
      "create b Bot",
      "replace m3 m4 long-idle",
    ])
  })

  it("asks again before a new Main that follows a compaction in the same pause", async () => {
    const { clock, agents, log, controller } = await setup()
    agents.set("m1", { status: "idle", inboxEmpty: true, usagePercent: 70 })
    controller.turnEnded("m1", NOON)
    await clock.advance(11 * MINUTE)
    controller.compactionsCounted("m1", 3)
    await clock.advance(MINUTE)
    expect(log.slice(0, 4)).toEqual([COMPACT_TURN, "compact m1", ROTATE_TURN, "create b Bot"])
    expect(log[4]).toBe("replace m1 m2 compactions")
  })

  it("gives the maintenance up when the turn does not complete", async () => {
    const { clock, agents, log, warnings, state, controller } = await setup()
    agents.set("m1", { status: "idle", inboxEmpty: true, usagePercent: 70 })
    state.turn = async () => ({ ended: "failed", message: "the model refused" })
    controller.turnEnded("m1", NOON)
    await clock.advance(11 * MINUTE)
    expect(log).toEqual([COMPACT_TURN])
    expect(warnings).toEqual([
      expect.stringContaining(
        `Preparing the Main session failed (${MEMORY_FLUSH_ID}): the memory write-out turn failed: the model refused`,
      ),
    ])
    state.turn = async () => ({ ended: "cancelled", message: "cancelled by user" })
    expect(await controller.startNew("b")).toEqual({
      outcome: "refused",
      reason: "preparation-failed",
      message: `Preparing the Main session failed (${MEMORY_FLUSH_ID}): the memory write-out turn cancelled: cancelled by user`,
    })
    expect(log).toEqual([COMPACT_TURN, ROTATE_TURN])
  })

  it("gives the maintenance up when its time runs out during the turn", async () => {
    const { clock, log, state, deadline, controller } = await setup()
    state.turn = () => new Promise(() => {})
    controller.turnEnded("m1", NOON)
    await clock.advance(11 * MINUTE)
    const started = controller.startNew("b")
    await clock.advance(0)
    deadline.controller.abort()
    expect(await started).toMatchObject({
      outcome: "refused",
      reason: "preparation-failed",
      message: expect.stringContaining("did not end in time"),
    })
    expect(log).toEqual([ROTATE_TURN])
  })

  it("does nothing when the bot or the defaults turn it off, and the maintenance goes on", async () => {
    const { clock, agents, log, controller, store } = await setup()
    agents.set("m1", { status: "idle", inboxEmpty: true, usagePercent: 70 })
    await store.setOverride("b", { memoryFlush: { enabled: false } })
    controller.turnEnded("m1", NOON)
    await clock.advance(11 * MINUTE)
    expect(log).toEqual(["compact m1"])

    log.length = 0
    await store.setOverride("b", {})
    await store.setDefaults({ ...DEFAULT_MAIN_ROTATION, memoryFlush: { enabled: false } })
    expect(await controller.startNew("b")).toEqual({ outcome: "started", sessionId: "m2" })
    expect(log[0]).toBe("create b Bot")
  })
})

describe("the memory write-out prompt", () => {
  it("says what is about to happen and where each kind of memory goes", () => {
    const compact = memoryFlushPrompt({ kind: "compact" })
    const rotate = memoryFlushPrompt({ kind: "rotate", reason: "daily" })
    expect(compact.text).toContain("will be compacted soon")
    expect(rotate.text).toContain("a new Main session takes over")
    expect(rotate).toEqual(memoryFlushPrompt({ kind: "rotate", reason: "owner" }))
    for (const { text } of [compact, rotate]) {
      expect(text).toContain("that thing's own note (note_write), as its current state")
      expect(text).toContain("today's daily note (note_write with action append)")
      expect(text).toContain("pinned Now note")
      expect(text).toContain("with note_link")
      expect(text).toContain("write where it came from")
      expect(text).toContain("If there is nothing new to write, write nothing.")
      expect(text).toContain("keep it to one short line")
    }
  })
})

describe("the memory write-out setting", () => {
  it("is on by default, checked in the settings and laid over by a bot", () => {
    expect(DEFAULT_MAIN_ROTATION.memoryFlush).toEqual({ enabled: true })
    const { memoryFlush: _memoryFlush, ...without } = DEFAULT_MAIN_ROTATION
    expect(() => validateMainRotationSettings(without)).toThrow(/memoryFlush/)
    expect(() =>
      validateMainRotationSettings({ ...DEFAULT_MAIN_ROTATION, memoryFlush: { enabled: "no" } }),
    ).toThrow(/memoryFlush.enabled/)
    const override = validateMainRotationOverride({ memoryFlush: { enabled: false } })
    expect(effectiveMainRotation(DEFAULT_MAIN_ROTATION, override).memoryFlush).toEqual({
      enabled: false,
    })
    expect(validateMainRotationOverride({ memoryFlush: {} })).toEqual({})
  })

  it("is added, on, to defaults stored before it existed", async () => {
    const { memoryFlush: _memoryFlush, ...stored } = DEFAULT_MAIN_ROTATION
    const settings = memoryTable<StoredMainSettings>()
    await settings.put(MAIN_DEFAULTS_KEY, { ...stored, quietMinutes: 7 })
    const store = await openMainStore({
      mainSettings: settings,
      mainOverrides: memoryTable(),
      mainActivity: memoryTable(),
    })
    expect(store.defaults()).toEqual({ ...DEFAULT_MAIN_ROTATION, quietMinutes: 7 })
    expect(settings.get(MAIN_DEFAULTS_KEY)).toEqual({ ...DEFAULT_MAIN_ROTATION, quietMinutes: 7 })
  })
})
