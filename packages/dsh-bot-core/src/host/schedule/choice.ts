import type { RunTrigger } from "./domain"
import { type RunOutcome, streakAfter } from "./runs"

export interface NoticeChoiceInput {
  readonly trigger: RunTrigger
  readonly outcome: RunOutcome["kind"]
  readonly previousStreak: number
}

export type NoticeChoice =
  | { readonly kind: "outcome"; readonly recoveredFrom: number }
  | { readonly kind: "failure" }
  | {
      readonly kind: "recovery"
      readonly outcome: "quiet" | "nothing"
      readonly recoveredFrom: number
    }
  | { readonly kind: "empty"; readonly outcome: "quiet" | "nothing" }
  | { readonly kind: "none" }

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
