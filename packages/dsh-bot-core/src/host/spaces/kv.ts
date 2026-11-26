import {
  isSpaceJson,
  SPACE_KV_KEY,
  SPACE_LIMITS,
  type SpaceJson,
  type SpaceKvEntry,
  type SpaceKvListing,
  type SpaceKvOperation,
  type SpacePageErrorCode,
  type SpaceRecord,
  type SpaceViewer,
  spaceIdOf,
} from "../../shared/spaces"
import type { SpaceLive } from "./live"
import { jsonBytes, type SpaceKvWrite, type SpaceStore } from "./store"

export type KvRefusal = {
  readonly ok: false
  readonly status: 400 | 403 | 404 | 413 | 429
  readonly code: SpacePageErrorCode
  readonly message: string
}

export type KvOutcome<T> = { readonly ok: true; readonly value: T } | KvRefusal

export interface SpaceKv {
  get(spaceId: string, key: string): SpaceJson | undefined
  list(spaceId: string, prefix: string): SpaceKvListing
  writable(space: SpaceRecord, viewer: SpaceViewer): boolean
  fromPage(space: SpaceRecord, viewer: SpaceViewer, operation: unknown): Promise<KvOutcome<true>>
  fromBot(
    spaceId: string,
    entries: readonly SpaceKvEntry[],
    deletes: readonly string[],
  ): Promise<KvOutcome<{ readonly set: number; readonly deleted: number }>>
  forget(spaceId: string): void
}

const refuse = (
  status: KvRefusal["status"],
  code: SpacePageErrorCode,
  message: string,
): KvRefusal => ({
  ok: false,
  status,
  code,
  message,
})

const bad = (message: string) => refuse(400, "space/bad-request", message)

const kib = (bytes: number) => `${Math.round(bytes / 1024)} KiB`

export function parseKvOperation(input: unknown): SpaceKvOperation | KvRefusal {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return bad('the body must be { "op": "set", "key", "value" } or { "op": "delete", "key" }')
  }
  const { op, key, value } = input as Record<string, unknown>
  if (typeof key !== "string" || !SPACE_KV_KEY.test(key)) {
    return bad("key must be 1-128 characters of A-Z, a-z, 0-9, '.', '_', ':', '/' and '-'")
  }
  if (op === "delete") return { op, key }
  if (op !== "set") return bad('op must be "set" or "delete"')
  if (!isSpaceJson(value)) return bad("value must be JSON")
  return { op, key, value }
}

export function createSpaceKv(deps: {
  readonly store: Pick<SpaceStore, "kvGet" | "kvList" | "kvStats" | "kvWrite">
  readonly live: Pick<SpaceLive, "publish">
  now(): number
}): SpaceKv {
  const visitorWrites = new Map<string, number[]>()

  const fits = (spaceId: string, writes: readonly SpaceKvWrite[]): KvRefusal | undefined => {
    const stats = deps.store.kvStats(spaceId)
    let keys = stats.keys
    let bytes = stats.bytes
    for (const write of writes) {
      const before = deps.store.kvGet(spaceId, write.key)
      if (before !== undefined) {
        keys -= 1
        bytes -= write.key.length + jsonBytes(before.value as SpaceJson)
      }
      if (write.op === "set") {
        keys += 1
        bytes += write.key.length + jsonBytes(write.value)
      }
    }
    if (keys > SPACE_LIMITS.kvKeys) {
      return refuse(413, "space/too-large", `a Space keeps at most ${SPACE_LIMITS.kvKeys} keys`)
    }
    if (bytes > SPACE_LIMITS.kvBytes) {
      return refuse(
        413,
        "space/too-large",
        `a Space keeps at most ${kib(SPACE_LIMITS.kvBytes)} of values`,
      )
    }
    return undefined
  }

  const apply = async (spaceId: string, writes: readonly SpaceKvWrite[]) => {
    await deps.store.kvWrite(spaceId, writes)
    for (const write of writes) {
      deps.live.publish(spaceId, {
        event: "kv",
        data: write.op === "set" ? { key: write.key, value: write.value } : { key: write.key },
      })
    }
  }

  const visitorAllowed = (spaceId: string) => {
    const now = deps.now()
    const recent = (visitorWrites.get(spaceId) ?? []).filter((at) => at > now - 60_000)
    if (recent.length >= SPACE_LIMITS.kvVisitorWritesPerMinute) {
      visitorWrites.set(spaceId, recent)
      return false
    }
    recent.push(now)
    visitorWrites.set(spaceId, recent)
    return true
  }

  const writable = (space: SpaceRecord, viewer: SpaceViewer) =>
    viewer !== "public" || space.visitorWrites

  return {
    get: (spaceId, key) => deps.store.kvGet(spaceId, key)?.value as SpaceJson | undefined,
    list(spaceId, prefix) {
      const all = deps.store.kvList(spaceId, prefix)
      return {
        entries: all
          .slice(0, SPACE_LIMITS.kvListEntries)
          .map(([key, record]) => ({ key, value: record.value as SpaceJson })),
        truncated: all.length > SPACE_LIMITS.kvListEntries,
      }
    },
    writable,
    async fromPage(space, viewer, input) {
      const spaceId = spaceIdOf(space.botId, space.slug)
      if (!writable(space, viewer)) {
        return refuse(403, "space/forbidden", "visitors of this public page can only read")
      }
      const operation = parseKvOperation(input)
      if ("ok" in operation) return operation
      if (operation.op === "set") {
        const size = jsonBytes(operation.value)
        const max =
          viewer === "public" ? SPACE_LIMITS.kvVisitorValueBytes : SPACE_LIMITS.kvValueBytes
        if (size > max)
          return refuse(413, "space/too-large", `a value may have at most ${kib(max)}`)
      }
      const write: SpaceKvWrite =
        operation.op === "set"
          ? { op: "set", key: operation.key, value: operation.value, at: deps.now() }
          : { op: "delete", key: operation.key }
      const problem = fits(spaceId, [write])
      if (problem !== undefined) return problem
      if (viewer === "public" && !visitorAllowed(spaceId)) {
        return refuse(
          429,
          "space/rate-limited",
          "too many writes from visitors; try again in a minute",
        )
      }
      await apply(spaceId, [write])
      return { ok: true, value: true }
    },
    async fromBot(spaceId, entries, deletes) {
      const at = deps.now()
      const keys = new Set<string>()
      const writes: SpaceKvWrite[] = []
      for (const entry of entries) {
        if (!SPACE_KV_KEY.test(entry.key)) return bad(`the key "${entry.key}" is not a valid key`)
        if (!isSpaceJson(entry.value)) return bad(`the value of "${entry.key}" is not JSON`)
        if (jsonBytes(entry.value) > SPACE_LIMITS.kvValueBytes) {
          return refuse(
            413,
            "space/too-large",
            `the value of "${entry.key}" is larger than ${kib(SPACE_LIMITS.kvValueBytes)}`,
          )
        }
        if (keys.has(entry.key)) return bad(`"${entry.key}" is named twice`)
        keys.add(entry.key)
        writes.push({ op: "set", key: entry.key, value: entry.value, at })
      }
      for (const key of deletes) {
        if (!SPACE_KV_KEY.test(key)) return bad(`the key "${key}" is not a valid key`)
        if (keys.has(key)) return bad(`"${key}" is named twice`)
        keys.add(key)
        writes.push({ op: "delete", key })
      }
      if (writes.length === 0) return bad("give entries to set or keys to delete")
      const problem = fits(spaceId, writes)
      if (problem !== undefined) return problem
      await apply(spaceId, writes)
      return { ok: true, value: { set: entries.length, deleted: deletes.length } }
    },
    forget(spaceId) {
      visitorWrites.delete(spaceId)
    },
  }
}
