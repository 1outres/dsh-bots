import { isMatrixError, type MatrixApi, type MatrixSync } from "./matrix"
import { type Scheduler, sleep } from "./ports"

export const BASE_RETRY_MS = 1_000
export const MAX_RETRY_MS = 60_000
export const SYNC_TIMEOUT_MS = 30_000

const TIMELINE_TYPES = ["m.room.message", "m.reaction", "m.room.redaction", "m.room.member"]

export const syncFilter = (initial: boolean) => ({
  presence: { not_types: ["*"] },
  account_data: { not_types: ["*"] },
  room: {
    timeline: { types: TIMELINE_TYPES, ...(initial ? { limit: 0 } : { limit: 50 }) },
    state: { lazy_load_members: true },
    ephemeral: { not_types: ["*"] },
    account_data: { not_types: ["*"] },
  },
})

export interface SyncLoopDeps {
  readonly api: Pick<MatrixApi, "sync">
  readonly scheduler: Scheduler
  readonly signal: AbortSignal
  since(): string | undefined
  handle(sync: MatrixSync, initial: boolean): Promise<void>
  saved(nextBatch: string): Promise<void>
  healthy(): void
  unhealthy(message: string): void
  refused(error: unknown): void
  warn(message: string): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function runSyncLoop(deps: SyncLoopDeps): Promise<void> {
  let since = deps.since()
  let delay = BASE_RETRY_MS
  let healthy = false
  while (!deps.signal.aborted) {
    try {
      const initial = since === undefined
      const sync = await deps.api.sync({
        ...(initial ? {} : { since }),
        timeoutMs: initial ? 0 : SYNC_TIMEOUT_MS,
        filter: syncFilter(initial),
        signal: deps.signal,
      })
      await deps.handle(sync, initial)
      await deps.saved(sync.nextBatch)
      since = sync.nextBatch
      delay = BASE_RETRY_MS
      if (!healthy) {
        healthy = true
        deps.healthy()
      }
    } catch (error) {
      if (deps.signal.aborted) return
      if (isMatrixError(error, "bad-since")) {
        deps.warn(
          `bot-matrix: the homeserver refused the saved sync position, so the messages sent meanwhile are skipped: ${messageOf(error)}`,
        )
        since = undefined
        continue
      }
      if (isMatrixError(error, "token")) {
        deps.refused(error)
        return
      }
      healthy = false
      deps.unhealthy(messageOf(error))
      await sleep(deps.scheduler, delay, deps.signal).catch(() => undefined)
      delay = Math.min(delay * 2, MAX_RETRY_MS)
    }
  }
}
