import type { BotTable } from "../registry"
import { ONBOARDING_STATE_KEY, type OnboardingRecord } from "./domain"
import { initialRecord, type PriorInstallation } from "./initial"

export interface OnboardingStoreDeps {
  /** The state table of ONBOARDING_DOMAIN; only the store writes it (design rule 57). */
  readonly onboardingState: BotTable<OnboardingRecord>
  /** Read only when nothing is stored yet. */
  prior(): PriorInstallation
  readonly version: string
  now(): number
}

/** The stored onboarding state. Changes run one at a time. */
export interface OnboardingStore {
  current(): OnboardingRecord
  /**
   * Run `work` alone among the store's changes and store the record it
   * resolves with (nothing is written when it is the current one). A
   * rejection stores nothing and rejects the change.
   */
  change(
    work: (current: OnboardingRecord) => OnboardingRecord | Promise<OnboardingRecord>,
  ): Promise<OnboardingRecord>
  /** Called after every stored change. */
  subscribe(listener: () => void): () => void
}

/**
 * Opens the store: a first start stores the record {@link initialRecord}
 * decides; only stored records are read after that.
 */
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
