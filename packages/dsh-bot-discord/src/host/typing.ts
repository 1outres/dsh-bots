import type { Scheduler } from "./ports"

export const TYPING_INTERVAL_MS = 8_000
export const PULSE_DELAY_MS = 1_500

export interface TypingDeps {
  show(current: () => boolean): Promise<void>
  scheduler: Scheduler
  warn(message: string): void
}

export interface TypingKeeper {
  start(): void
  stop(): void
  pulse(): void
  active(): boolean
}

export function createTypingKeeper(deps: TypingDeps): TypingKeeper {
  let active = false
  let generation = 0
  let cancel: () => void = () => {}

  const tick = () => {
    const run = generation
    cancel = deps.scheduler.later(TYPING_INTERVAL_MS, tick)
    deps
      .show(() => active && generation === run)
      .catch((error: unknown) => deps.warn(`bot-discord: could not show typing: ${String(error)}`))
  }

  return {
    start() {
      if (active) return
      active = true
      generation += 1
      tick()
    },
    stop() {
      if (!active) return
      active = false
      generation += 1
      cancel()
    },
    pulse() {
      if (!active) return
      cancel()
      cancel = deps.scheduler.later(PULSE_DELAY_MS, tick)
    },
    active: () => active,
  }
}
