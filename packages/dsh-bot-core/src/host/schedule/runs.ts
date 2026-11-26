import type { RunFailure, RunRecord, RunTrigger } from "./domain"

export type RunOutcome =
  | { readonly kind: "quiet" }
  | { readonly kind: "ran" }
  | { readonly kind: "reported" }
  | { readonly kind: "nothing" }
  | { readonly kind: "failed"; readonly failure: RunFailure }

export interface RunStart {
  readonly botId: string
  readonly jobId: string
  readonly trigger: RunTrigger
  readonly scheduledAt: number
  readonly now: number
}

export class RunStateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "RunStateError"
  }
}

export function startedRun(start: RunStart): RunRecord {
  return {
    botId: start.botId,
    jobId: start.jobId,
    trigger: start.trigger,
    scheduledAt: start.scheduledAt,
    startedAt: start.now,
    state: "running",
  }
}

export function skippedRun(start: RunStart): RunRecord {
  return { ...startedRun(start), state: "skipped", endedAt: start.now }
}

const requireRunning = (run: RunRecord) => {
  if (run.state !== "running") throw new RunStateError(`the run already ended (${run.state})`)
}

export function withSession(run: RunRecord, sessionId: string): RunRecord {
  requireRunning(run)
  if (run.sessionId !== undefined) throw new RunStateError("the run already has its session")
  return { ...run, sessionId }
}

export function endedRun(run: RunRecord, outcome: RunOutcome, now: number): RunRecord {
  requireRunning(run)
  return {
    ...run,
    state: outcome.kind,
    endedAt: now,
    ...(outcome.kind === "failed" ? { failure: outcome.failure } : {}),
  }
}

export interface StreakChange {
  readonly failureStreak: number
  readonly announce?: "failure" | "recovery"
}

export function streakAfter(previous: number, outcome: RunOutcome["kind"]): StreakChange {
  if (outcome === "failed") {
    return previous === 0
      ? { failureStreak: 1, announce: "failure" }
      : { failureStreak: previous + 1 }
  }
  return previous > 0 ? { failureStreak: 0, announce: "recovery" } : { failureStreak: 0 }
}
