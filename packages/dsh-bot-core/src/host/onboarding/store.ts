import type { BotTable } from "../registry"
import { ONBOARDING_STATE_KEY, type OnboardingRecord } from "./domain"
import { initialRecord, type PriorInstallation } from "./initial"

export interface OnboardingStoreDeps {
  readonly onboardingState: BotTable<OnboardingRecord>
  prior(): PriorInstallation
  readonly version: string
  now(): number
}

export interface OnboardingStore {
  current(): OnboardingRecord
  change(
    work: (current: OnboardingRecord) => OnboardingRecord | Promise<OnboardingRecord>,
  ): Promise<OnboardingRecord>
  subscribe(listener: () => void): () => void
}

export async function openOnboardingStore(deps: OnboardingStoreDeps): Promise<OnboardingStore> {
  const { onboardingState } = deps
  const stored = onboardingState.get(ONBOARDING_STATE_KEY)
  let current: OnboardingRecord = stored ?? initialRecord(deps.prior(), deps.version, deps.now())
  if (stored === undefined) await onboardingState.put(ONBOARDING_STATE_KEY, current)
  const listeners = new Set<() => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  return {
    current: () => current,
    change: (work) =>
      serial(async () => {
        const next = await work(current)
        if (next === current) return current
        await onboardingState.put(ONBOARDING_STATE_KEY, next)
        current = next
        for (const listener of [...listeners]) listener()
        return next
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
