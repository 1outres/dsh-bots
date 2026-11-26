import type { BotQuestionWait } from "../../shared/interactions"

export interface ForegroundWaitDeps {
  readonly remainingMs: number
  now(): number
  later(ms: number, work: () => void): () => void
  expired(): void
  changed(wait: BotQuestionWait): void
}

export interface ForegroundWait {
  current(): BotQuestionWait
  hold(): void
  stop(): void
}

export function createForegroundWait(deps: ForegroundWaitDeps): ForegroundWait {
  const deadline = deps.now() + Math.max(0, deps.remainingMs)
  let wait: BotQuestionWait = { state: "counting", deadline }
  const set = (next: BotQuestionWait) => {
    wait = next
    deps.changed(next)
  }
  let cancel = deps.later(Math.max(0, deadline - deps.now()), () => {
    if (wait.state !== "counting") return
    set({ state: "continued" })
    deps.expired()
  })
  return {
    current: () => wait,
    hold() {
      if (wait.state !== "counting") return
      cancel()
      set({ state: "held" })
    },
    stop() {
      cancel()
      cancel = () => {}
    },
  }
}
