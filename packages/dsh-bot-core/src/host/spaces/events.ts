import {
  isSpaceJson,
  SPACE_EVENT_NAME,
  SPACE_LIMITS,
  type SpaceEventResult,
  type SpaceJson,
  type SpaceRecord,
  type SpaceViewer,
  spaceIdOf,
} from "../../shared/spaces"
import type { NoticeSpace } from "../notices/domain"
import { jsonBytes } from "./store"
import { type SpaceEventEntry, spaceEventNotice } from "./texts"

export type SpaceEventInput =
  | { readonly ok: true; readonly name: string; readonly data: SpaceJson }
  | { readonly ok: false; readonly reason: "bad-request" | "too-large"; readonly message: string }

export function parseSpaceEvent(input: unknown): SpaceEventInput {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, reason: "bad-request", message: 'the body must be { "name", "data"? }' }
  }
  const { name, data } = input as Record<string, unknown>
  if (typeof name !== "string" || !SPACE_EVENT_NAME.test(name)) {
    return {
      ok: false,
      reason: "bad-request",
      message: "name must be 1-64 characters of A-Z, a-z, 0-9, '.', '_' and '-'",
    }
  }
  const value = data === undefined ? null : data
  if (!isSpaceJson(value)) return { ok: false, reason: "bad-request", message: "data must be JSON" }
  if (jsonBytes(value) > SPACE_LIMITS.eventDataBytes) {
    return { ok: false, reason: "too-large", message: "data may have at most 16 KiB" }
  }
  return { ok: true, name, data: value }
}

export interface SpaceEventsDeps {
  enqueue(
    botId: string,
    notice: { readonly text: string; readonly summary: string },
    space: NoticeSpace,
  ): Promise<void>
  withdraw(matches: (space: NoticeSpace) => boolean): Promise<number>
  pending(spaceId: string): number
  newNonce(): string
  later(ms: number, work: () => void): () => void
  now(): number
  warn(message: string): void
}

export interface SpaceEvents {
  accept(space: SpaceRecord, viewer: SpaceViewer, name: string, data: SpaceJson): SpaceEventResult
  discard(spaceId: string, scope: "public" | "all"): Promise<number>
  dispose(): void
}

interface Batch {
  readonly space: SpaceRecord
  readonly public: boolean
  readonly events: SpaceEventEntry[]
  cancel: () => void
}

const batchKey = (spaceId: string, visitors: boolean) =>
  `${spaceId}|${visitors ? "public" : "known"}`

export function createSpaceEvents(deps: SpaceEventsDeps): SpaceEvents {
  const batches = new Map<string, Batch>()
  const windows = new Map<string, { all: number[]; visitors: number[] }>()
  let disposed = false

  const windowOf = (spaceId: string) => {
    const since = deps.now() - 60_000
    const known = windows.get(spaceId) ?? { all: [], visitors: [] }
    const current = {
      all: known.all.filter((at) => at > since),
      visitors: known.visitors.filter((at) => at > since),
    }
    windows.set(spaceId, current)
    return current
  }

  const batched = (spaceId: string) =>
    [true, false].reduce(
      (sum, visitors) => sum + (batches.get(batchKey(spaceId, visitors))?.events.length ?? 0),
      0,
    )

  const flush = (key: string) => {
    const batch = batches.get(key)
    if (batch === undefined) return
    batches.delete(key)
    const spaceId = spaceIdOf(batch.space.botId, batch.space.slug)
    const notice = spaceEventNotice(batch.space, batch.public, batch.events, deps.newNonce())
    deps
      .enqueue(batch.space.botId, notice, {
        spaceId,
        public: batch.public,
        events: batch.events.length,
      })
      .catch((error: unknown) => {
        deps.warn(
          `bot-core: could not tell bot "${batch.space.botId}" of the operations on its Space "${batch.space.slug}": ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }

  return {
    accept(space, viewer, name, data) {
      if (disposed) return { accepted: false, reason: "queue-full" }
      const spaceId = spaceIdOf(space.botId, space.slug)
      const window = windowOf(spaceId)
      const visitors = viewer === "public"
      if (
        window.all.length >= SPACE_LIMITS.eventsPerMinute ||
        (visitors && window.visitors.length >= SPACE_LIMITS.publicEventsPerMinute)
      ) {
        return { accepted: false, reason: "rate-limited" }
      }
      if (batched(spaceId) + deps.pending(spaceId) >= SPACE_LIMITS.pendingEvents) {
        return { accepted: false, reason: "queue-full" }
      }
      const now = deps.now()
      window.all.push(now)
      if (visitors) window.visitors.push(now)
      const key = batchKey(spaceId, visitors)
      let batch = batches.get(key)
      if (batch === undefined) {
        const created: Batch = { space, public: visitors, events: [], cancel: () => {} }
        created.cancel = deps.later(SPACE_LIMITS.eventBatchMs, () => flush(key))
        batches.set(key, created)
        batch = created
      }
      batch.events.push({ viewer, name, data, at: now })
      return { accepted: true }
    },
    async discard(spaceId, scope) {
      let dropped = 0
      for (const visitors of scope === "all" ? [true, false] : [true]) {
        const key = batchKey(spaceId, visitors)
        const batch = batches.get(key)
        if (batch === undefined) continue
        batch.cancel()
        batches.delete(key)
        dropped += batch.events.length
      }
      if (scope === "all") windows.delete(spaceId)
      return (
        dropped +
        (await deps.withdraw(
          (space) => space.spaceId === spaceId && (scope === "all" || space.public),
        ))
      )
    },
    dispose() {
      disposed = true
      for (const batch of batches.values()) batch.cancel()
      batches.clear()
      windows.clear()
    },
  }
}
