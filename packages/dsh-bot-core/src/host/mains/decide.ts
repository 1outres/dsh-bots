import type { MainRotationReason, MainRotationSettings } from "../../shared/mains"

export interface MainFacts {
  readonly lastTurnAt?: number
  readonly compactions: number
  readonly usagePercent?: number
  readonly idleCompactedFor?: number
}

export type MainTrigger = "tick" | "input"

export interface MainDecisionInput {
  readonly now: number
  readonly trigger: MainTrigger
  readonly settings: MainRotationSettings
  readonly facts: MainFacts
  readonly dailyBoundary?: number
}

export type MainDecision =
  | { readonly kind: "rotate"; readonly reason: Exclude<MainRotationReason, "owner"> }
  | { readonly kind: "compact" }
  | { readonly kind: "wait"; readonly until?: number }

const MINUTE = 60_000

const WAIT: MainDecision = { kind: "wait" }

export function decideMain(input: MainDecisionInput): MainDecision {
  const { now, settings, facts, dailyBoundary } = input
  const { lastTurnAt } = facts
  if (lastTurnAt === undefined) return WAIT
  const quietAt = lastTurnAt + settings.quietMinutes * MINUTE
  if (now < quietAt) return { kind: "wait", until: quietAt }
  if (settings.daily.enabled && dailyBoundary !== undefined && dailyBoundary <= now) {
    return { kind: "rotate", reason: "daily" }
  }
  const counting = settings.compactions.enabled
  if (counting && facts.compactions >= settings.compactions.count) {
    return { kind: "rotate", reason: "compactions" }
  }
  if (input.trigger === "input") {
    if (settings.longIdle.enabled && now - lastTurnAt >= settings.longIdle.minutes * MINUTE) {
      return { kind: "rotate", reason: "long-idle" }
    }
    return WAIT
  }
  const { idleCompaction } = settings
  if (
    idleCompaction.enabled &&
    facts.usagePercent !== undefined &&
    facts.usagePercent >= idleCompaction.minUsagePercent &&
    facts.idleCompactedFor !== lastTurnAt
  ) {
    return counting && facts.compactions + 1 >= settings.compactions.count
      ? { kind: "rotate", reason: "compactions" }
      : { kind: "compact" }
  }
  if (settings.daily.enabled && dailyBoundary !== undefined) {
    return { kind: "wait", until: dailyBoundary }
  }
  return WAIT
}
