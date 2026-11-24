/** The text of the notices a run sends the bot's Main session. Pure. */
import type { RunFailure, RunTrigger, ScheduleMode } from "./domain"
import { formatLocal, formatSpan } from "./timing"

/** A run's lateness from this much on is told. */
export const LATE_AFTER_MS = 60_000

/** What every notice of one run names. */
export interface NoticeRun {
  readonly jobId: string
  readonly name: string
  readonly mode: ScheduleMode
  readonly timezone: string
  readonly trigger: RunTrigger
  readonly scheduledAt: number
  readonly ranAt: number
}

/** The check's standard output. */
export interface CheckOutput {
  readonly text: string
  readonly truncated: boolean
}

export interface ScheduleNotice {
  readonly text: string
  readonly summary: string
}

const REPLY =
  "Reply to the user as usual; if there is nothing worth telling them, call stay_silent before writing anything."

function header(run: NoticeRun): string {
  const local = (ms: number) => formatLocal(ms, run.timezone)
  const late = run.ranAt - run.scheduledAt
  const when =
    run.trigger === "manual"
      ? `run on request, ran ${local(run.ranAt)}`
      : `scheduled ${local(run.scheduledAt)}, ran ${local(run.ranAt)}${late >= LATE_AFTER_MS ? `, late by ${formatSpan(late)}` : ""}`
  return `[schedule] "${run.name}" (${run.jobId}) — ${when}`
}

function checkLines(output: CheckOutput | undefined): string[] {
  if (output === undefined || output.text === "") return []
  return [`check output${output.truncated ? " (its last part only)" : ""}:`, output.text]
}

const recoveredLine = (failures: number) =>
  failures > 0 ? [`This run succeeded after ${failures} failed run(s) in a row.`] : []

/** The one prompt of a `separate` run's own session. */
export function separatePrompt(
  run: NoticeRun,
  instruction: string,
  output: CheckOutput | undefined,
): ScheduleNotice {
  return {
    text: [
      header(run),
      "You are carrying out this scheduled job on your own, in a session apart from your Main conversation. Nothing you write here reaches the user.",
      "Instruction:",
      instruction,
      ...checkLines(output),
      'When you are done, call schedule_result once: { "outcome": "report", "report": "..." } with what the user should learn (your Main session tells them), or { "outcome": "nothing" } when there is nothing worth telling. Ending without calling it counts as a failed run.',
      "The schedule tool can update or delete this job (no id needed).",
    ].join("\n"),
    summary: `Schedule "${run.name}": separate run`,
  }
}

/** `main`: the instruction, which the Main session carries out in its conversation. */
export function runNotice(
  run: NoticeRun,
  instruction: string,
  output: CheckOutput | undefined,
  recoveredFrom: number,
): ScheduleNotice {
  return {
    text: [
      header(run),
      "kind: run",
      "Carry out this scheduled instruction now, as part of this conversation:",
      instruction,
      ...checkLines(output),
      ...recoveredLine(recoveredFrom),
      REPLY,
    ].join("\n"),
    summary: `Schedule "${run.name}": run`,
  }
}

/** `separate`: what the run reported. */
export function resultNotice(
  run: NoticeRun,
  report: string,
  output: CheckOutput | undefined,
  recoveredFrom: number,
): ScheduleNotice {
  return {
    text: [
      header(run),
      "kind: result",
      "A separate run of this schedule reported:",
      report,
      ...checkLines(output),
      ...recoveredLine(recoveredFrom),
      REPLY,
    ].join("\n"),
    summary: `Schedule "${run.name}": result`,
  }
}

function failureLines(failure: RunFailure): string[] {
  const what = failure.stage === "check" ? "Its check command failed" : "Its run failed"
  return [
    `${what}: ${failure.message}`,
    ...(failure.exitCode === undefined ? [] : [`exit code: ${failure.exitCode}`]),
    ...(failure.stderr === undefined || failure.stderr === ""
      ? []
      : ["stderr (last part):", failure.stderr]),
  ]
}

export interface FailureContext {
  /** The job recurs and is armed, so further timed failures can follow (and are not told). */
  readonly hasNextRun: boolean
}

/** A failed run: the first of a streak, or a manual one. */
export function failureNotice(
  run: NoticeRun,
  failure: RunFailure,
  context: FailureContext,
): ScheduleNotice {
  return {
    text: [
      header(run),
      "kind: failure",
      ...failureLines(failure),
      ...(context.hasNextRun
        ? ["Further failures of this schedule are not told until a run succeeds again."]
        : []),
      REPLY,
    ].join("\n"),
    summary: `Schedule "${run.name}": failed`,
  }
}

const EMPTY_LINES = {
  quiet: "kind: quiet — the check found nothing to do",
  nothing: "kind: nothing — the run found nothing worth telling",
} as const

/** A manual run that ended without anything to tell (quiet check, nothing to report). */
export function emptyNotice(run: NoticeRun, outcome: "quiet" | "nothing"): ScheduleNotice {
  return {
    text: [header(run), EMPTY_LINES[outcome]].join("\n"),
    summary: `Schedule "${run.name}": ${outcome}`,
  }
}

/** A run that recovered from a streak without anything else to tell (quiet check, nothing to report). */
export function recoveryNotice(
  run: NoticeRun,
  outcome: "quiet" | "nothing",
  recoveredFrom: number,
): ScheduleNotice {
  return {
    text: [
      header(run),
      "kind: recovery",
      `This run succeeded after ${recoveredFrom} failed run(s) in a row; ${
        outcome === "quiet" ? "its check found nothing to do" : "it had nothing to report"
      }.`,
      REPLY,
    ].join("\n"),
    summary: `Schedule "${run.name}": recovered`,
  }
}
