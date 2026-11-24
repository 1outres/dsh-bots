import type { MainRotationReason, MainRotationSettings } from "../../shared/mains"

/** What bot-core knows of the bot's current Main when it decides. */
export interface MainFacts {
  /** End of its last ordinary turn; absent while it has had none (an unused Main). */
  readonly lastTurnAt?: number
  /** Successful compactions in its log. */
  readonly compactions: number
  /** How full its context is, in percent; absent when unknown (its Agent is not loaded). */
  readonly usagePercent?: number
  /** The `lastTurnAt` after which an idle compaction was already tried. */
  readonly idleCompactedFor?: number
}

/**
 * Why bot-core looks: `tick` (a turn ended, the Main became idle, a timer,
 * a settings change, start-up) or `input` (right before an input is handed to the Main).
 */
export type MainTrigger = "tick" | "input"

export interface MainDecisionInput {
  readonly now: number
  readonly trigger: MainTrigger
  readonly settings: MainRotationSettings
  readonly facts: MainFacts
  /** The first daily boundary after the Main became the Main; absent when there is none. */
  readonly dailyBoundary?: number
}

/** What to do with the bot's Main: compact it, replace it, or look again `until` (absent: at the next event). */
export type MainDecision =
  | { readonly kind: "rotate"; readonly reason: Exclude<MainRotationReason, "owner"> }
  | { readonly kind: "compact" }
  | { readonly kind: "wait"; readonly until?: number }

const MINUTE = 60_000

const WAIT: MainDecision = { kind: "wait" }

/** docs/specs/bot-main-rotation.md §3. Whether the Main is idle is not decided here. */
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
