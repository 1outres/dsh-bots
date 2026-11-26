import type { Scheduler } from "./ports"

export const TYPING_INTERVAL_MS = 20_000
export const TYPING_TIMEOUT_MS = 30_000
export const PULSE_DELAY_MS = 1_500

export interface TypingDeps {
  show(typing: boolean, current: () => boolean): Promise<void>
  scheduler: Scheduler
  warn(message: string): void
}

export interface TypingKeeper {
  start(): void
  stop(): void
  pulse(): void
}

export function createTypingKeeper(deps: TypingDeps): TypingKeeper {
  let active = false
  let generation = 0
  let cancel: () => void = () => {}
  const show = (typing: boolean, run: number) =>
    deps
      .show(typing, () => (typing ? active && generation === run : true))
      .catch((error: unknown) => deps.warn(`bot-matrix: could not show typing: ${String(error)}`))
  const tick = () => {
    const run = generation
    cancel = deps.scheduler.later(TYPING_INTERVAL_MS, tick)
    void show(true, run)
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
      void show(false, generation)
    },
    pulse() {
      if (!active) return
      cancel()
      cancel = deps.scheduler.later(PULSE_DELAY_MS, tick)
    },
  }
}
