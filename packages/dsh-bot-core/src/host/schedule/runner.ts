/**
 * One run of a job, from its check to what reaches the Main session:
 *
 * - the previous run of the job still running: `skipped`;
 * - a check: exit 0 goes on with its output, exit 1 ends `quiet`, anything
 *   else (or the time limit) fails the run;
 * - `main`: a notice with the instruction to the Main session (`ran`);
 * - `separate`: a new session of the bot (Bot.createSession) runs the
 *   instruction as one turn and answers with `schedule_result`: a report
 *   goes to the Main session (`reported`), nothing is only recorded
 *   (`nothing`); a turn that ends without it, or any error, fails the run.
 *   The session is archived afterwards.
 *
 * Which notice the Main session gets is {@link chooseNotice}'s: a timed run
 * tells a failure only when it starts a streak, a manual run always tells its
 * outcome, and the run that ends a streak says so.
 */
import { endedTurnOf, type TurnEndReason } from "../channels/feed"
import { type CheckRunner, checkVerdict } from "./check"
import { chooseNotice, type NoticeChoice } from "./choice"
import type { RunFailure, RunTrigger, ScheduleJob, ScheduleRun } from "./domain"
import { recursArmed } from "./jobs"
import {
  type CheckOutput,
  emptyNotice,
  failureNotice,
  type NoticeRun,
  recoveryNotice,
  resultNotice,
  runNotice,
  type ScheduleNotice,
  separatePrompt,
} from "./notice"
import { endedRun, type RunOutcome, skippedRun, startedRun, streakAfter, withSession } from "./runs"
import type { ScheduleStore } from "./store"

/** What a separate run's session answers with `schedule_result`. */
export type ScheduleResult =
  | { readonly outcome: "report"; readonly report: string }
  | { readonly outcome: "nothing" }

export interface ScheduleRunnerDeps {
  store: ScheduleStore
  check: CheckRunner
  /** Store a notice for the bot's Main session (the notice outbox). */
  notify(botId: string, notice: ScheduleNotice): Promise<void>
  /** Bot.createSession: a new session of the bot under its preset. */
  openSession(botId: string, title: string): Promise<string>
  /** Hand a session its prompt, which opens its turn. */
  prompt(sessionId: string, prompt: ScheduleNotice): Promise<void>
  /** Archive a session, stopping what it still runs. */
  archive(sessionId: string): Promise<void>
  later(ms: number, work: () => void): () => void
  /** Longest a separate run's session may take before the run fails. */
  readonly separateLimitMs: number
  now(): number
  newId(): string
  warn(message: string): void
}

export interface ScheduleRunner {
  /** Whether a run of the job is running. */
  isRunning(jobId: string): boolean
  /**
   * Run the job for its occurrence `scheduledAt` (or a manual run), or record
   * it `skipped` while its previous run runs. Resolves once the run ended.
   */
  start(job: ScheduleJob, trigger: RunTrigger, scheduledAt: number): Promise<ScheduleRun>
  /** A session's log event (`session/event`): a separate run ends with its session's turn. */
  sessionEvent(sessionId: string, event: { readonly type: string; readonly data: unknown }): void
  /** The run whose own session this is, while it runs. */
  runOfSession(sessionId: string): ScheduleRun | undefined
  /** `schedule_result` of a separate run's session. @throws when none waits for it. */
  result(sessionId: string, result: ScheduleResult): void
  /** Runs stored as running are from before a restart: they failed. */
  recover(): Promise<void>
}

interface Waiting {
  readonly runId: string
  result?: ScheduleResult
  readonly end: (reason: TurnEndReason | "time-limit") => void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

type ToldOutcome = Extract<RunOutcome, { readonly kind: "ran" | "reported" }>

/** How a run ended, with the notice of an outcome that carries its own. */
type Ending =
  | { readonly outcome: ToldOutcome; readonly notice: (recoveredFrom: number) => ScheduleNotice }
  | { readonly outcome: Exclude<RunOutcome, ToldOutcome> }

const runFailure = (message: string): Ending => ({
  outcome: { kind: "failed", failure: { stage: "run", message } },
})

export function createScheduleRunner(deps: ScheduleRunnerDeps): ScheduleRunner {
  const active = new Set<string>()
  const waiting = new Map<string, Waiting>()

  const noticeRun = (job: ScheduleJob, run: ScheduleRun): NoticeRun => ({
    jobId: job.id,
    name: job.name,
    mode: job.mode,
    timezone: job.timezone,
    trigger: run.trigger,
    scheduledAt: run.scheduledAt,
    ranAt: run.startedAt,
  })

  const send = async (botId: string, notice: ScheduleNotice) => {
    try {
      await deps.notify(botId, notice)
    } catch (error) {
      deps.warn(
        `bot-core: could not store a schedule notice of bot "${botId}": ${messageOf(error)}`,
      )
    }
  }

  const render = (
    job: ScheduleJob,
    run: ScheduleRun,
    ending: Ending,
    choice: NoticeChoice,
  ): ScheduleNotice | undefined => {
    const context = noticeRun(job, run)
    switch (choice.kind) {
      case "none":
        return undefined
      case "outcome":
        if (!("notice" in ending)) throw new Error(`a ${ending.outcome.kind} run has no notice`)
        return ending.notice(choice.recoveredFrom)
      case "failure": {
        if (ending.outcome.kind !== "failed") throw new Error("only a failed run has a failure")
        const current = deps.store.job(job.id)
        return failureNotice(context, ending.outcome.failure, {
          hasNextRun: current !== undefined && recursArmed(current),
        })
      }
      case "recovery":
        return recoveryNotice(context, choice.outcome, choice.recoveredFrom)
      case "empty":
        return emptyNotice(context, choice.outcome)
    }
  }

  /** End the run: tell the Main session what it should hear, record the run and the job's streak. */
  const conclude = async (
    job: ScheduleJob,
    run: ScheduleRun,
    ending: Ending,
  ): Promise<ScheduleRun> => {
    const { outcome } = ending
    const previous = deps.store.job(job.id)?.failureStreak ?? 0
    const change = streakAfter(previous, outcome.kind)
    const choice = chooseNotice({
      trigger: run.trigger,
      outcome: outcome.kind,
      previousStreak: previous,
    })
    const notice = render(job, run, ending, choice)
    if (notice !== undefined) await send(job.botId, notice)
    const ended = await deps.store.putRun(run.id, endedRun(run, outcome, deps.now()))
    const current = deps.store.job(job.id)
    if (current !== undefined && current.failureStreak !== change.failureStreak) {
      await deps.store.putJob(job.id, { ...current, failureStreak: change.failureStreak })
    }
    return ended
  }

  const runSeparate = async (
    job: ScheduleJob,
    run: ScheduleRun,
    output: CheckOutput | undefined,
  ): Promise<ScheduleRun> => {
    let sessionId: string
    try {
      sessionId = await deps.openSession(job.botId, `Schedule: ${job.name}`)
    } catch (error) {
      return conclude(job, run, runFailure(`its session could not start: ${messageOf(error)}`))
    }
    const opened = await deps.store.putRun(run.id, withSession(run, sessionId))
    let settle: (reason: TurnEndReason | "time-limit") => void = () => {}
    const ended = new Promise<TurnEndReason | "time-limit">((resolve) => {
      settle = resolve
    })
    const entry: Waiting = { runId: run.id, end: (reason) => settle(reason) }
    waiting.set(sessionId, entry)
    const cancel = deps.later(deps.separateLimitMs, () => entry.end("time-limit"))
    try {
      try {
        await deps.prompt(sessionId, separatePrompt(noticeRun(job, run), job.instruction, output))
      } catch (error) {
        return await conclude(
          job,
          opened,
          runFailure(`its session could not be given the instruction: ${messageOf(error)}`),
        )
      }
      const reason = await ended
      const result = entry.result
      if (result?.outcome === "report") {
        return await conclude(job, opened, {
          outcome: { kind: "reported" },
          notice: (recoveredFrom) =>
            resultNotice(noticeRun(job, run), result.report, output, recoveredFrom),
        })
      }
      if (result?.outcome === "nothing") {
        return await conclude(job, opened, { outcome: { kind: "nothing" } })
      }
      if (reason === "time-limit") {
        return await conclude(
          job,
          opened,
          runFailure(
            `its session did not finish within ${Math.round(deps.separateLimitMs / 60_000)} minutes`,
          ),
        )
      }
      const state = endedTurnOf(reason)
      return await conclude(
        job,
        opened,
        runFailure(
          state?.phase === "failed"
            ? `its session's turn failed: ${state.message}`
            : state?.phase === "cancelled"
              ? "its session's turn was cancelled"
              : "its session ended its turn without calling schedule_result",
        ),
      )
    } finally {
      cancel()
      waiting.delete(sessionId)
      deps.archive(sessionId).catch((error: unknown) => {
        deps.warn(
          `bot-core: could not archive the schedule session "${sessionId}": ${messageOf(error)}`,
        )
      })
    }
  }

  const execute = async (job: ScheduleJob, run: ScheduleRun): Promise<ScheduleRun> => {
    let output: CheckOutput | undefined
    if (job.check !== undefined) {
      let verdict: ReturnType<typeof checkVerdict>
      try {
        verdict = checkVerdict(await deps.check(job.botId, job.check), job.check)
      } catch (error) {
        verdict = { kind: "failed", failure: { stage: "check", message: messageOf(error) } }
      }
      if (verdict.kind === "quiet") return conclude(job, run, { outcome: { kind: "quiet" } })
      if (verdict.kind === "failed") return conclude(job, run, { outcome: verdict })
      output = verdict.output
    }
    if (job.mode === "main") {
      return conclude(job, run, {
        outcome: { kind: "ran" },
        notice: (recoveredFrom) =>
          runNotice(noticeRun(job, run), job.instruction, output, recoveredFrom),
      })
    }
    return runSeparate(job, run, output)
  }

  return {
    isRunning: (jobId) => active.has(jobId),
    async start(job, trigger, scheduledAt) {
      const start = { botId: job.botId, jobId: job.id, trigger, scheduledAt, now: deps.now() }
      if (active.has(job.id)) return deps.store.putRun(deps.newId(), skippedRun(start))
      active.add(job.id)
      try {
        const run = await deps.store.putRun(deps.newId(), startedRun(start))
        try {
          return await execute(job, run)
        } catch (error) {
          const current = deps.store.run(run.id) ?? run
          if (current.state !== "running") throw error
          return await conclude(job, current, runFailure(messageOf(error)))
        }
      } finally {
        active.delete(job.id)
      }
    },
    sessionEvent(sessionId, event) {
      if (event.type !== "turn/end") return
      waiting.get(sessionId)?.end((event.data as { readonly reason: TurnEndReason }).reason)
    },
    runOfSession(sessionId) {
      const entry = waiting.get(sessionId)
      return entry === undefined ? undefined : deps.store.run(entry.runId)
    },
    result(sessionId, result) {
      const entry = waiting.get(sessionId)
      if (entry === undefined)
        throw new Error("no scheduled run is waiting for a result in this session")
      if (entry.result !== undefined)
        throw new Error("schedule_result was already called in this run")
      entry.result = result
    },
    async recover() {
      for (const run of deps.store.running()) {
        const failure: RunFailure = {
          stage: "run",
          message: "the Host stopped while this run was in progress",
        }
        const job = deps.store.job(run.jobId)
        if (job === undefined) {
          await deps.store.putRun(run.id, endedRun(run, { kind: "failed", failure }, deps.now()))
        } else {
          await conclude(job, run, { outcome: { kind: "failed", failure } })
        }
        if (run.sessionId !== undefined) {
          await deps.archive(run.sessionId).catch((error: unknown) => {
            deps.warn(
              `bot-core: could not archive the schedule session "${run.sessionId}": ${messageOf(error)}`,
            )
          })
        }
      }
    },
  }
}
