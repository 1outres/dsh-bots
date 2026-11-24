import type { BotTable } from "../registry"
import type { JobRecord, RunRecord, ScheduleJob, ScheduleRun } from "./domain"

export interface ScheduleStoreDeps {
  /** The tables of SCHEDULES_DOMAIN; only the store writes them (design rule 42). */
  jobs: BotTable<JobRecord>
  runs: BotTable<RunRecord>
  /** Ended runs kept per job, newest first. */
  readonly keepRuns: number
}

/**
 * Bots' schedule jobs and their latest runs. Writes are serialized; a run
 * belongs to its job: deleting the job deletes its ended runs, and a run that
 * ends after its job was deleted is not kept.
 */
export interface ScheduleStore {
  /** Jobs, oldest first; only `botId`'s when given. */
  jobs(botId?: string): ScheduleJob[]
  job(id: string): ScheduleJob | undefined
  putJob(id: string, record: JobRecord): Promise<ScheduleJob>
  deleteJob(id: string): Promise<void>
  /** The job's runs, newest first. */
  runs(jobId: string): ScheduleRun[]
  run(id: string): ScheduleRun | undefined
  /** The kept run of a `separate` job that ran in `sessionId`. */
  runOfSession(sessionId: string): ScheduleRun | undefined
  /** Every run still running. */
  running(): ScheduleRun[]
  putRun(id: string, record: RunRecord): Promise<ScheduleRun>
  /** Drop the jobs (and runs) of bots `keep` refuses. */
  purge(keep: (botId: string) => boolean): Promise<void>
}

/** The stored part of a value that may carry its id. */
function stored<V extends object>(value: V & { readonly id?: string }): V {
  const { id: _id, ...record } = value
  return record as V
}

export function createScheduleStore(deps: ScheduleStoreDeps): ScheduleStore {
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const allRuns = () =>
    [...deps.runs.entries()].map(([id, record]): ScheduleRun => ({ ...record, id }))
  const runsOf = (jobId: string) =>
    allRuns()
      .filter((run) => run.jobId === jobId)
      .sort((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))

  const dropEnded = async (jobId: string, keep: number) => {
    const ended = runsOf(jobId).filter((run) => run.state !== "running")
    for (const run of ended.slice(keep)) await deps.runs.delete(run.id)
  }

  return {
    jobs: (botId) =>
      [...deps.jobs.entries()]
        .map(([id, record]): ScheduleJob => ({ ...record, id }))
        .filter((job) => botId === undefined || job.botId === botId)
        .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)),
    job(id) {
      const record = deps.jobs.get(id)
      return record === undefined ? undefined : { ...record, id }
    },
    putJob: (id, record) =>
      serial(async () => {
        const value = stored(record)
        await deps.jobs.put(id, value)
        return { ...value, id }
      }),
    deleteJob: (id) =>
      serial(async () => {
        await deps.jobs.delete(id)
        await dropEnded(id, 0)
      }),
    runs: runsOf,
    run(id) {
      const record = deps.runs.get(id)
      return record === undefined ? undefined : { ...record, id }
    },
    runOfSession: (sessionId) => allRuns().find((run) => run.sessionId === sessionId),
    running: () => allRuns().filter((run) => run.state === "running"),
    putRun: (id, record) =>
      serial(async () => {
        const value = stored(record)
        if (value.state !== "running" && deps.jobs.get(value.jobId) === undefined) {
          await deps.runs.delete(id)
          return { ...value, id }
        }
        await deps.runs.put(id, value)
        await dropEnded(value.jobId, deps.keepRuns)
        return { ...value, id }
      }),
    purge: (keep) =>
      serial(async () => {
        for (const [id, record] of [...deps.jobs.entries()]) {
          if (!keep(record.botId)) await deps.jobs.delete(id)
        }
        for (const [id, record] of [...deps.runs.entries()]) {
          if (!keep(record.botId) && record.state !== "running") await deps.runs.delete(id)
        }
      }),
  }
}
