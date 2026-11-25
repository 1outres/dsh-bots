import type { BotsSnapshot } from "../../shared/bots"
import type { OnboardingStore } from "./store"
import { welcomeAfter } from "./welcome"

export interface WelcomeFollowerDeps {
  readonly store: Pick<OnboardingStore, "change">
  readonly bots: {
    snapshot(): Pick<BotsSnapshot, "bots" | "pending">
    subscribe(listener: () => void): () => void
  }
  now(): number
  warn(message: string): void
}

/**
 * Settle a creating guide from the bots list (`welcomeAfter`) now and after
 * every change of it, whether or not a page is open. Returns the disposer.
 */
export function followWelcomeBot(deps: WelcomeFollowerDeps): () => void {
  const settle = () => {
    deps.store
      .change((current) => {
        const welcome = welcomeAfter(current.welcome, deps.bots.snapshot(), deps.now())
        return welcome === current.welcome
          ? current
          : { ...current, welcome, updatedAt: deps.now() }
      })
      .catch((error: unknown) =>
        deps.warn(`bot-core: the welcome guide's bot could not be followed: ${String(error)}`),
      )
  }
  const off = deps.bots.subscribe(settle)
  settle()
  return off
}
