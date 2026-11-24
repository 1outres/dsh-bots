import { describe, expect, it } from "vitest"
import { createLimiter } from "../src/host/limit"

describe("createLimiter", () => {
  it("runs at most `size` tasks at once and lets aborted waiters go", async () => {
    const limiter = createLimiter(2)
    let running = 0
    let peak = 0
    const gates: Array<() => void> = []
    const task = () =>
      new Promise<void>((resolve) => {
        running++
        peak = Math.max(peak, running)
        gates.push(() => {
          running--
          resolve()
        })
      })
    const first = limiter.run(task)
    const second = limiter.run(task)
    const controller = new AbortController()
    const third = limiter.run(task, controller.signal)
    const fourth = limiter.run(task)
    await Promise.resolve()
    expect(running).toBe(2)
    controller.abort(new Error("bot deleted"))
    await expect(third).rejects.toThrow("bot deleted")
    gates.shift()?.()
    await first
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(running).toBe(2)
    for (const gate of gates.splice(0)) gate()
    await Promise.all([second, fourth])
    expect(peak).toBe(2)
  })
})
