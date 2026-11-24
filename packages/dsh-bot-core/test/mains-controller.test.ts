import { describe, expect, it } from "vitest"
import { createMainPreparations } from "../src/host/mains/preparations"
import type { MainPreparation } from "../src/mains-contract"
import { DEFAULT_MAIN_ROTATION } from "../src/shared/mains"
import { MINUTE, NOON, mainControllerSetup as setup } from "./mains-support"

describe("Main controller", () => {
  it("compacts a full Main once the conversation pauses, once per pause", async () => {
    const { clock, agents, log, controller, store } = await setup()
    agents.set("m1", { status: "idle", inboxEmpty: true, usagePercent: 70 })
    controller.turnEnded("m1", NOON)
    await clock.advance(9 * MINUTE)
    expect(log).toEqual([])
    await clock.advance(2 * MINUTE)
    expect(log).toEqual(["compact m1"])
    expect(store.activity("b", "m1")).toMatchObject({ lastTurnAt: NOON, idleCompactedFor: NOON })
    controller.poke("b")
    await clock.advance(MINUTE)
    expect(log).toEqual(["compact m1"])
  })

  it("decides on a turn's end only once it is recorded, even when the Main turns idle first", async () => {
    const { clock, agents, log, controller } = await setup()
    agents.set("m1", { status: "idle", inboxEmpty: true, usagePercent: 70 })
    controller.turnEnded("m1", NOON - 30 * MINUTE)
    await clock.advance(MINUTE)
    expect(log).toEqual(["compact m1"])
    controller.turnEnded("m1", clock.now())
    controller.poke("b")
    await clock.advance(0)
    expect(log).toEqual(["compact m1"])
    await clock.advance(11 * MINUTE)
    expect(log).toEqual(["compact m1", "compact m1"])
  })

  it("starts a new Main after the daily time once paused, without a word to it", async () => {
    const { clock, log, controller, store, bot } = await setup()
    controller.turnEnded("m1", NOON)
    await clock.advance(17 * 60 * MINUTE)
    expect(log).toEqual(["create b Bot", "replace m1 m2 daily", "changed b", "archive m1"])
    expect(bot.current.mainSessionId).toBe("m2")
    expect(store.activity("b", "m2")).toEqual({ compactions: 0 })
    await clock.advance(48 * 60 * MINUTE)
    expect(log).toHaveLength(4)
  })

  it("waits for an idle Main: a running turn or an open question holds the new Main back", async () => {
    const { clock, agents, log, controller, state } = await setup()
    agents.set("m1", { status: "running", inboxEmpty: true, usagePercent: 10 })
    controller.turnEnded("m1", NOON)
    await clock.advance(17 * 60 * MINUTE)
    expect(log).toEqual([])
    agents.set("m1", { status: "idle", inboxEmpty: true, usagePercent: 10 })
    state.interactions = 1
    controller.poke("b")
    await clock.advance(MINUTE)
    expect(log).toEqual([])
    state.interactions = 0
    controller.poke("b")
    await clock.advance(MINUTE)
    expect(log[1]).toBe("replace m1 m2 daily")
  })

  it("replaces the Main before the first input after a long pause, and hands the input to the new one", async () => {
    const { clock, controller, store, log, preparations } = await setup()
    await store.setDefaults({ ...DEFAULT_MAIN_ROTATION, daily: { enabled: false, time: "04:00" } })
    const asked: boolean[] = []
    preparations.register({
      id: "memory",
      order: 1,
      async prepare(request) {
        asked.push(request.holdingInput)
        await request.runTurn({ text: "write notes", summary: "notes" })
      },
    })
    controller.turnEnded("m1", NOON)
    await clock.advance(6 * 60 * MINUTE)
    expect(log).toEqual([])
    const reached = await controller.admit("b", async (sessionId) => sessionId)
    expect(reached).toBe("m2")
    expect(asked).toEqual([true])
    expect(log).toEqual([
      "turn m1 notes",
      "create b Bot",
      "replace m1 m2 long-idle",
      "changed b",
      "archive m1",
    ])
    expect(await controller.admit("b", async (sessionId) => sessionId)).toBe("m2")
  })

  it("holds inputs that arrive during a maintenance until it ends", async () => {
    const { clock, controller, preparations } = await setup()
    let release: () => void = () => {}
    preparations.register({
      id: "slow",
      order: 0,
      prepare: () => new Promise<void>((done) => (release = done)),
    })
    controller.turnEnded("m1", NOON)
    await clock.advance(11 * MINUTE)
    const started = controller.startNew("b")
    await clock.advance(0)
    expect(controller.maintenance("b")).toBe("rotating")
    const reached = controller.admit("b", async (sessionId) => sessionId)
    release()
    expect(await started).toEqual({ outcome: "started", sessionId: "m2" })
    expect(await reached).toBe("m2")
  })

  it("gives a maintenance up when a preparation fails, and waits before the next try", async () => {
    const { clock, controller, log, warnings, preparations } = await setup()
    const failing: MainPreparation = {
      id: "memory",
      order: 0,
      prepare: async () => {
        throw new Error("no notes")
      },
    }
    const off = preparations.register(failing)
    controller.turnEnded("m1", NOON)
    await clock.advance(16 * 60 * MINUTE + 1)
    expect(log).toEqual([])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("Preparing the Main session failed (memory): no notes")
    await clock.advance(5 * MINUTE + 10 * MINUTE + 20 * MINUTE + 20 * MINUTE)
    expect(warnings).toHaveLength(5)
    off()
    controller.poke("b")
    await clock.advance(MINUTE)
    expect(log).toEqual([])
    await clock.advance(20 * MINUTE)
    expect(log[1]).toBe("replace m1 m2 daily")
  })

  it("checks idleness again after the preparations' turns", async () => {
    const { clock, controller, agents, log, preparations } = await setup()
    preparations.register({
      id: "memory",
      order: 0,
      async prepare(request) {
        await request.runTurn({ text: "x", summary: "s" })
        agents.set("m1", { status: "running", inboxEmpty: false, usagePercent: 10 })
      },
    })
    controller.turnEnded("m1", NOON)
    await clock.advance(11 * MINUTE)
    expect(await controller.startNew("b")).toMatchObject({ outcome: "refused", reason: "busy" })
    expect(log).toEqual(["turn m1 s"])
  })

  it("answers the owner: unchanged for an unused Main, refused while busy or not ready", async () => {
    const { clock, controller, agents, state } = await setup()
    expect(await controller.startNew("b")).toEqual({ outcome: "unchanged" })
    controller.turnEnded("m1", NOON)
    await clock.advance(0)
    agents.set("m1", { status: "running", inboxEmpty: true, usagePercent: 10 })
    expect(await controller.startNew("b")).toMatchObject({ outcome: "refused", reason: "busy" })
    agents.delete("m1")
    state.notReady = true
    expect(await controller.startNew("b")).toMatchObject({
      outcome: "refused",
      reason: "not-ready",
    })
    state.notReady = false
    expect(await controller.startNew("b")).toEqual({ outcome: "started", sessionId: "m2" })
  })

  it("orders preparations and refuses a duplicate id", () => {
    const preparations = createMainPreparations()
    const make = (id: string, order: number): MainPreparation => ({
      id,
      order,
      prepare: async () => {},
    })
    preparations.register(make("b", 2))
    preparations.register(make("a", 1))
    preparations.register(make("c", 1))
    expect(preparations.list().map((item) => item.id)).toEqual(["a", "c", "b"])
    expect(() => preparations.register(make("a", 0))).toThrow(/already/)
  })
})
