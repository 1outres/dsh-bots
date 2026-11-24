import { describe, expect, it } from "vitest"
import { createTypingKeeper, PULSE_DELAY_MS, TYPING_INTERVAL_MS } from "../src/host/typing"
import { manualClock, settle } from "./support"

function setup() {
  const clock = manualClock()
  const shown: number[] = []
  const pending: (() => boolean)[] = []
  const keeper = createTypingKeeper({
    async show(current) {
      shown.push(clock.now())
      pending.push(current)
    },
    scheduler: clock.scheduler,
    warn: () => {},
  })
  return { clock, keeper, shown, pending }
}

describe("typing keeper", () => {
  it("shows typing at once and again before Discord's ten seconds run out", async () => {
    const { clock, keeper, shown } = setup()
    keeper.start()
    clock.advance(TYPING_INTERVAL_MS)
    clock.advance(TYPING_INTERVAL_MS)
    await settle()
    expect(shown).toEqual([0, 8000, 16000])
    expect(TYPING_INTERVAL_MS).toBeLessThan(10_000)
  })

  it("stops for good, and starts only once", async () => {
    const { clock, keeper, shown } = setup()
    keeper.start()
    keeper.start()
    keeper.stop()
    clock.advance(60_000)
    await settle()
    expect(shown).toEqual([0])
    expect(clock.pending()).toBe(0)
    expect(keeper.active()).toBe(false)
  })

  it("shows it again shortly after a pulse while active, and not once stopped meanwhile", async () => {
    const { clock, keeper, shown } = setup()
    keeper.pulse()
    keeper.start()
    clock.advance(3_000)
    keeper.pulse()
    clock.advance(PULSE_DELAY_MS)
    expect(shown).toEqual([0, 3000 + PULSE_DELAY_MS])
    clock.advance(TYPING_INTERVAL_MS)
    expect(shown).toEqual([0, 3000 + PULSE_DELAY_MS, 3000 + PULSE_DELAY_MS + TYPING_INTERVAL_MS])
    keeper.pulse()
    keeper.stop()
    keeper.pulse()
    clock.advance(60_000)
    await settle()
    expect(shown).toHaveLength(3)
    expect(clock.pending()).toBe(0)
  })

  it("marks a showing outdated once stopped, even when started again", () => {
    const { keeper, pending } = setup()
    keeper.start()
    expect(pending[0]?.()).toBe(true)
    keeper.stop()
    expect(pending[0]?.()).toBe(false)
    keeper.start()
    expect(pending[0]?.()).toBe(false)
    expect(pending[1]?.()).toBe(true)
  })
})
