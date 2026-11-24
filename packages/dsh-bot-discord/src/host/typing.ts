import type { Scheduler } from "./ports"

/** Discord shows "typing" for about ten seconds; it is sent again before that ends. */
export const TYPING_INTERVAL_MS = 8_000
/** How long after a message the bot sent typing shows again, so a turn ending right after it shows none. */
export const PULSE_DELAY_MS = 1_500

export interface TypingDeps {
  /**
   * Show typing once. `current` turns false as soon as this showing is
   * outdated (stopped, or started again), so a queued showing can skip itself.
   */
  show(current: () => boolean): Promise<void>
  scheduler: Scheduler
  warn(message: string): void
}

export interface TypingKeeper {
  /** Show typing until {@link stop}, refreshing it every {@link TYPING_INTERVAL_MS}. */
  start(): void
  stop(): void
  /** While typing, show it again shortly (a message the bot sent cleared it). */
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
