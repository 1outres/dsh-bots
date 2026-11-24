/** The state machine of one run, and what a run's end does to its job's failure streak. Pure. */
import type { RunFailure, RunRecord, RunTrigger } from "./domain"

/** How a run ended. */
export type RunOutcome =
  /** The check exited 1: nothing to do, the model was not asked. */
  | { readonly kind: "quiet" }
  /** `main`: the instruction went to the Main session. */
  | { readonly kind: "ran" }
  /** `separate`: the run's report went to the Main session. */
  | { readonly kind: "reported" }
  /** `separate`: the run had nothing to report. */
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

/** A run that did not start: the job's previous run was still running. */
export function skippedRun(start: RunStart): RunRecord {
  return { ...startedRun(start), state: "skipped", endedAt: start.now }
}

const requireRunning = (run: RunRecord) => {
  if (run.state !== "running") throw new RunStateError(`the run already ended (${run.state})`)
}

/** The run's separate session is open. */
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

/** The job's failure streak after a run, and which notice of it the Main session gets. */
export interface StreakChange {
  readonly failureStreak: number
  /** `failure`: the first failure of a streak; `recovery`: the first run after one. */
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
