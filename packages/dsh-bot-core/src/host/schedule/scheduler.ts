/**
 * When jobs are due: one timer for the earliest armed job. A due job's latest
 * occurrence runs once (missed ones collapse into it, an expired `at` runs
 * once), and its next occurrence is stored before the run starts.
 */
import type { ScheduleJob } from "./domain"
import { isArmed } from "./jobs"
import type { ScheduleStore } from "./store"
import { decideDue } from "./timing"

export interface SchedulerDeps {
  store: ScheduleStore
  /** Start a run of the job for its occurrence; not awaited. */
  start(job: ScheduleJob, scheduledAt: number): void
  now(): number
  later(ms: number, work: () => void): () => void
  /** Longest delay one timer may take; a later job is looked at again then. */
  readonly maxDelayMs: number
  warn(message: string): void
}

export interface Scheduler {
  /** Re-arm after jobs changed. */
  sync(): void
  dispose(): void
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  let cancel: (() => void) | undefined
  let ticking = false
  let again = false
  let disposed = false

  const sync = () => {
    void tick().catch((error: unknown) => {
      deps.warn(
        `bot-core: could not run due schedule jobs: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
  }

  const arm = () => {
    cancel?.()
    cancel = undefined
    if (disposed) return
    const due = deps.store.jobs().flatMap((job) => (isArmed(job) ? [job.nextRunAt] : []))
    if (due.length === 0) return
    const delay = Math.min(deps.maxDelayMs, Math.max(0, Math.min(...due) - deps.now()))
    cancel = deps.later(delay, () => {
      cancel = undefined
      sync()
    })
  }

  const tick = async () => {
    if (ticking) {
      again = true
      return
    }
    ticking = true
    try {
      do {
        again = false
        const now = deps.now()
        for (const job of deps.store.jobs()) {
          if (disposed) return
          if (!isArmed(job) || job.nextRunAt > now) continue
          const { nextRunAt: _next, ...rest } = job
          let decision: ReturnType<typeof decideDue>
          try {
            decision = decideDue(job, job.nextRunAt, now)
          } catch (error) {
            deps.warn(
              `bot-core: schedule job "${job.id}" stopped: its next run cannot be computed: ${error instanceof Error ? error.message : String(error)}`,
            )
            await deps.store.putJob(job.id, rest)
            continue
          }
          const advanced = await deps.store.putJob(job.id, {
            ...rest,
            ...(decision.next === undefined ? {} : { nextRunAt: decision.next }),
          })
          deps.start(advanced, decision.occurrenceAt)
        }
      } while (again && !disposed)
    } finally {
      ticking = false
      arm()
    }
  }

  return {
    sync,
    dispose() {
      disposed = true
      cancel?.()
      cancel = undefined
    },
  }
}
