/** Which notice, if any, the Main session gets at a run's end. Pure. */
import type { RunTrigger } from "./domain"
import { type RunOutcome, streakAfter } from "./runs"

export interface NoticeChoiceInput {
  readonly trigger: RunTrigger
  readonly outcome: RunOutcome["kind"]
  /** The job's failure streak before this run. */
  readonly previousStreak: number
}

export type NoticeChoice =
  /** `ran` / `reported`: the run's own notice (instruction or report). */
  | { readonly kind: "outcome"; readonly recoveredFrom: number }
  | { readonly kind: "failure" }
  /** The first run after a failure streak, with nothing else to tell. */
  | {
      readonly kind: "recovery"
      readonly outcome: "quiet" | "nothing"
      readonly recoveredFrom: number
    }
  /** A manual run with nothing else to tell. */
  | { readonly kind: "empty"; readonly outcome: "quiet" | "nothing" }
  | { readonly kind: "none" }

/**
 * Timed runs tell a failure only when it starts a streak, and nothing for a
 * quiet check or a `nothing` outcome unless the run ends a streak. A manual
 * run always tells its outcome.
 */
export function chooseNotice(input: NoticeChoiceInput): NoticeChoice {
  const announce = streakAfter(input.previousStreak, input.outcome).announce
  const recoveredFrom = announce === "recovery" ? input.previousStreak : 0
  const manual = input.trigger === "manual"
  switch (input.outcome) {
    case "ran":
    case "reported":
      return { kind: "outcome", recoveredFrom }
    case "failed":
      return announce === "failure" || manual ? { kind: "failure" } : { kind: "none" }
    case "quiet":
    case "nothing":
      if (announce === "recovery")
        return { kind: "recovery", outcome: input.outcome, recoveredFrom }
      return manual ? { kind: "empty", outcome: input.outcome } : { kind: "none" }
  }
}
