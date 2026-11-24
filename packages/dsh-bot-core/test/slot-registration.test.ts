import { afterEach, describe, expect, it, vi } from "vitest"
import { BOT_SESSION_PRIORITY } from "../src/client/slot-priority"
import { createSlotRegistration } from "../src/client/slot-registration"
import { value } from "./support/client"

describe("BOT_SESSION_PRIORITY", () => {
  it("is the lowest finite integer, below any priority another plugin picks", () => {
    expect(BOT_SESSION_PRIORITY).toBe(Number.MIN_SAFE_INTEGER)
  })
})

describe("createSlotRegistration", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const setup = (wanted: boolean, refuse = false) => {
    const want = value(wanted)
    const log: string[] = []
    const register = vi.fn((priority: number) => {
      if (refuse) throw new Error(`already registered at ${priority}`)
      log.push(`register ${priority}`)
      return () => log.push("dispose")
    })
    const registration = createSlotRegistration({ wanted: want, register, label: "shell" })
    return { want, log, register, registration }
  }

  it("registers at BOT_SESSION_PRIORITY only while wanted", () => {
    const { want, log, registration } = setup(false)
    expect(registration.getSnapshot()).toEqual({ state: "idle" })
    want.set(true)
    expect(log).toEqual([`register ${BOT_SESSION_PRIORITY}`])
    expect(registration.getSnapshot()).toEqual({ state: "active" })
    want.set(true)
    expect(log).toHaveLength(1)
    want.set(false)
    expect(log).toEqual([`register ${BOT_SESSION_PRIORITY}`, "dispose"])
    expect(registration.getSnapshot()).toEqual({ state: "idle" })
  })

  it("tries once: a refusal is logged, reported and never retried", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const { want, register, registration } = setup(true, true)
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith(BOT_SESSION_PRIORITY)
    expect(registration.getSnapshot()).toEqual({
      state: "refused",
      error: `already registered at ${BOT_SESSION_PRIORITY}`,
    })
    expect(error).toHaveBeenCalledTimes(1)
    for (const next of [false, true, false, true]) want.set(next)
    expect(register).toHaveBeenCalledTimes(1)
    expect(registration.getSnapshot().state).toBe("refused")
  })

  it("notifies its listeners of each change", () => {
    const { want, registration } = setup(false)
    const listener = vi.fn()
    registration.subscribe(listener)
    want.set(true)
    want.set(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it("releases the registration and stops following when disposed", () => {
    const { want, log, registration } = setup(true)
    registration.dispose()
    expect(log).toEqual([`register ${BOT_SESSION_PRIORITY}`, "dispose"])
    want.set(false)
    want.set(true)
    expect(log).toHaveLength(2)
  })
})
