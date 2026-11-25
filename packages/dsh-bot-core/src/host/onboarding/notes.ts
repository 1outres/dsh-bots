import { compareVersions, type ReleaseNote } from "../../shared/release-notes"

export interface ReleaseNotesKeeperDeps {
  readonly version: string
  /** The newest version whose notes were seen, as stored. */
  seen(): string
  /** Called after the stored onboarding state changed. */
  subscribe(listener: () => void): () => void
  /** The notes due after `seen` up to {@link version}, newest first; rejects when they cannot be read. */
  fetch(seen: string, signal: AbortSignal): Promise<readonly ReleaseNote[]>
  /** Store that every note up to {@link version} was seen: none was there to show. */
  record(version: string): Promise<void>
  /** Run `work` after `ms`; the returned function cancels it. */
  later(work: () => void, ms: number): () => void
  readonly retry: { readonly firstMs: number; readonly maxMs: number }
  warn(message: string): void
}

/**
 * The release notes of the versions since the stored one, read from where
 * they are published while the stored version is behind: nothing is shown
 * or stored until they are read, and a failed read is retried with backoff.
 * Read notes are kept for the process; none due only records the version.
 */
export interface ReleaseNotesKeeper {
  /** The notes read so far (empty until read). */
  notes(): readonly ReleaseNote[]
  subscribe(listener: () => void): () => void
  dispose(): void
}

export function createReleaseNotesKeeper(deps: ReleaseNotesKeeperDeps): ReleaseNotesKeeper {
  const listeners = new Set<() => void>()
  const stop = new AbortController()
  let read: readonly ReleaseNote[] | undefined
  let reading = false
  let backoff = deps.retry.firstMs
  let cancelRetry: (() => void) | undefined
  let recording = false
  const notify = () => {
    for (const listener of [...listeners]) listener()
  }
  const behind = () => compareVersions(deps.seen(), deps.version) < 0
  const due = (notes: readonly ReleaseNote[]) =>
    notes.some((note) => compareVersions(note.version, deps.seen()) > 0)

  const settle = () => {
    if (stop.signal.aborted || read === undefined || !behind() || due(read) || recording) return
    recording = true
    deps
      .record(deps.version)
      .catch((error: unknown) =>
        deps.warn(`bot-core: the release notes' version could not be stored: ${String(error)}`),
      )
      .finally(() => {
        recording = false
      })
  }

  const fetchNow = () => {
    if (stop.signal.aborted || reading || read !== undefined || !behind()) return
    reading = true
    cancelRetry = undefined
    deps.fetch(deps.seen(), stop.signal).then(
      (notes) => {
        reading = false
        if (stop.signal.aborted) return
        read = notes
        backoff = deps.retry.firstMs
        notify()
        settle()
      },
      (error: unknown) => {
        reading = false
        if (stop.signal.aborted) return
        deps.warn(`bot-core: the release notes could not be read, retrying: ${String(error)}`)
        cancelRetry = deps.later(fetchNow, backoff)
        backoff = Math.min(backoff * 2, deps.retry.maxMs)
      },
    )
  }

  const off = deps.subscribe(() => {
    fetchNow()
    settle()
  })
  fetchNow()

  return {
    notes: () => read ?? [],
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      off()
      stop.abort()
      cancelRetry?.()
      listeners.clear()
    },
  }
}
