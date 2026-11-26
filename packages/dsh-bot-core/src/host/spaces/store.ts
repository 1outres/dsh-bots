import {
  SPACE_LIMITS,
  type SpaceAccessRecord,
  type SpaceJson,
  type SpaceKvRecord,
  type SpaceRecord,
  type SpaceRevision,
  type SpaceSettingsRecord,
  spaceIdOf,
} from "../../shared/spaces"
import type { BotTable } from "../registry"
import { SPACE_SETTINGS_KEY } from "./domain"

export interface SpaceStoreDeps {
  readonly spaces: BotTable<SpaceRecord>
  readonly revisions: BotTable<SpaceRevision>
  readonly access: BotTable<SpaceAccessRecord>
  readonly kv: BotTable<SpaceKvRecord>
  readonly spaceSettings: BotTable<SpaceSettingsRecord>
}

export type SpaceRecordChange = Partial<
  Pick<SpaceRecord, "title" | "description" | "pinned" | "visibility" | "visitorWrites">
>

export type SpaceKvWrite =
  | { readonly op: "set"; readonly key: string; readonly value: SpaceJson; readonly at: number }
  | { readonly op: "delete"; readonly key: string }

export interface SpaceKvStats {
  readonly keys: number
  readonly bytes: number
}

export type SpaceStoreChange =
  | { readonly kind: "space"; readonly spaceId: string; readonly botId: string }
  | {
      readonly kind: "kv"
      readonly spaceId: string
      readonly botId: string
      readonly keys: readonly string[]
    }
  | { readonly kind: "settings" }

export interface SpaceStore {
  list(botId?: string): readonly SpaceRecord[]
  get(spaceId: string): SpaceRecord | undefined
  create(record: SpaceRecord): Promise<void>
  update(spaceId: string, change: SpaceRecordChange, at: number): Promise<SpaceRecord>
  revision(spaceId: string, number: number): SpaceRevision | undefined
  revisions(spaceId: string): readonly SpaceRevision[]
  publish(spaceId: string, revision: SpaceRevision, at: number): Promise<SpaceRecord>
  referencedBlobs(): ReadonlySet<string>
  botBlobs(botId: string): ReadonlyMap<string, number>
  access(hash: string): SpaceAccessRecord | undefined
  accesses(spaceId: string): readonly (readonly [string, SpaceAccessRecord])[]
  grant(hash: string, record: SpaceAccessRecord): Promise<void>
  revoke(hashes: readonly string[], at: number): Promise<void>
  kvGet(spaceId: string, key: string): SpaceKvRecord | undefined
  kvList(spaceId: string, prefix: string): readonly (readonly [string, SpaceKvRecord])[]
  kvStats(spaceId: string): SpaceKvStats
  kvWrite(spaceId: string, writes: readonly SpaceKvWrite[]): Promise<void>
  discard(spaceId: string): Promise<SpaceRecord | undefined>
  forget(keep: (botId: string) => boolean): Promise<readonly SpaceRecord[]>
  settings(): SpaceSettingsRecord | undefined
  setSettings(settings: SpaceSettingsRecord): Promise<void>
  subscribe(listener: (change: SpaceStoreChange) => void): () => void
}

const revisionKey = (spaceId: string, number: number) => `${spaceId}:${number}`

const kvKey = (spaceId: string, key: string) => `${spaceId}:${key}`

const byCreation = (left: SpaceRecord, right: SpaceRecord) =>
  left.createdAt - right.createdAt || (left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0)

export const jsonBytes = (value: SpaceJson) =>
  new TextEncoder().encode(JSON.stringify(value)).length

export function createSpaceStore(deps: SpaceStoreDeps): SpaceStore {
  const { spaces, revisions, access, kv, spaceSettings } = deps
  const listeners = new Set<(change: SpaceStoreChange) => void>()
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }
  const emit = (change: SpaceStoreChange) => {
    for (const listener of [...listeners]) listener(change)
  }
  const spaceChanged = (record: SpaceRecord) =>
    emit({ kind: "space", spaceId: spaceIdOf(record.botId, record.slug), botId: record.botId })

  const require = (spaceId: string) => {
    const record = spaces.get(spaceId)
    if (record === undefined) throw new Error(`there is no space "${spaceId}"`)
    return record
  }

  const revisionsOf = (spaceId: string) =>
    [...revisions.entries()]
      .filter(
        ([key]) => key.startsWith(`${spaceId}:`) && key.slice(spaceId.length + 1).match(/^[0-9]+$/),
      )
      .map(([, revision]) => revision)
      .sort((left, right) => right.number - left.number)

  const kvOf = (spaceId: string) =>
    [...kv.entries()].filter(([key]) => key.startsWith(`${spaceId}:`))

  const accessesOf = (spaceId: string) =>
    [...access.entries()].filter(([, record]) => record.spaceId === spaceId)

  const remove = async (record: SpaceRecord) => {
    const spaceId = spaceIdOf(record.botId, record.slug)
    for (const revision of revisionsOf(spaceId)) {
      await revisions.delete(revisionKey(spaceId, revision.number))
    }
    for (const [hash] of accessesOf(spaceId)) await access.delete(hash)
    for (const [key] of kvOf(spaceId)) await kv.delete(key)
    await spaces.delete(spaceId)
  }

  return {
    list: (botId) =>
      [...spaces.entries()]
        .map(([, record]) => record)
        .filter((record) => botId === undefined || record.botId === botId)
        .sort(byCreation),
    get: (spaceId) => spaces.get(spaceId),
    create: (record) =>
      serial(async () => {
        const spaceId = spaceIdOf(record.botId, record.slug)
        if (spaces.get(spaceId) !== undefined) throw new Error(`the space "${spaceId}" exists`)
        await spaces.put(spaceId, record)
        spaceChanged(record)
      }),
    update: (spaceId, change, at) =>
      serial(async () => {
        const before = require(spaceId)
        const next: SpaceRecord = { ...before, ...change, updatedAt: at }
        await spaces.put(spaceId, next)
        spaceChanged(next)
        return next
      }),
    revision: (spaceId, number) => revisions.get(revisionKey(spaceId, number)),
    revisions: revisionsOf,
    publish: (spaceId, revision, at) =>
      serial(async () => {
        const before = require(spaceId)
        await revisions.put(revisionKey(spaceId, revision.number), revision)
        const next: SpaceRecord = {
          ...before,
          source: { kind: "snapshot", revision: revision.number },
          updatedAt: at,
        }
        await spaces.put(spaceId, next)
        for (const old of revisionsOf(spaceId).slice(SPACE_LIMITS.revisionsKept)) {
          await revisions.delete(revisionKey(spaceId, old.number))
        }
        spaceChanged(next)
        return next
      }),
    referencedBlobs() {
      const hashes = new Set<string>()
      for (const [, revision] of revisions.entries()) {
        for (const file of Object.values(revision.files)) hashes.add(file.blob)
      }
      return hashes
    },
    botBlobs(botId) {
      const sizes = new Map<string, number>()
      for (const record of [...spaces.entries()].map(([, value]) => value)) {
        if (record.botId !== botId) continue
        for (const revision of revisionsOf(spaceIdOf(record.botId, record.slug))) {
          for (const file of Object.values(revision.files)) sizes.set(file.blob, file.bytes)
        }
      }
      return sizes
    },
    access: (hash) => access.get(hash),
    accesses: accessesOf,
    grant: (hash, record) =>
      serial(async () => {
        const space = require(record.spaceId)
        await access.put(hash, record)
        spaceChanged(space)
      }),
    revoke: (hashes, at) =>
      serial(async () => {
        const touched = new Set<string>()
        for (const hash of hashes) {
          const record = access.get(hash)
          if (record === undefined || record.revokedAt !== null) continue
          await access.put(hash, { ...record, revokedAt: at })
          touched.add(record.spaceId)
        }
        for (const spaceId of touched) {
          const space = spaces.get(spaceId)
          if (space !== undefined) spaceChanged(space)
        }
      }),
    kvGet: (spaceId, key) => kv.get(kvKey(spaceId, key)),
    kvList: (spaceId, prefix) =>
      kvOf(spaceId)
        .map(([key, record]) => [key.slice(spaceId.length + 1), record] as const)
        .filter(([key]) => key.startsWith(prefix))
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
    kvStats(spaceId) {
      let keys = 0
      let bytes = 0
      for (const [key, record] of kvOf(spaceId)) {
        keys += 1
        bytes += key.length - spaceId.length - 1 + jsonBytes(record.value as SpaceJson)
      }
      return { keys, bytes }
    },
    kvWrite: (spaceId, writes) =>
      serial(async () => {
        const space = require(spaceId)
        for (const write of writes) {
          if (write.op === "set") {
            await kv.put(kvKey(spaceId, write.key), { value: write.value, updatedAt: write.at })
          } else {
            await kv.delete(kvKey(spaceId, write.key))
          }
        }
        emit({
          kind: "kv",
          spaceId,
          botId: space.botId,
          keys: writes.map((write) => write.key),
        })
      }),
    discard: (spaceId) =>
      serial(async () => {
        const record = spaces.get(spaceId)
        if (record === undefined) return undefined
        await remove(record)
        spaceChanged(record)
        return record
      }),
    forget: (keep) =>
      serial(async () => {
        const gone = [...spaces.entries()]
          .map(([, record]) => record)
          .filter((record) => !keep(record.botId))
        for (const record of gone) {
          await remove(record)
          spaceChanged(record)
        }
        return gone
      }),
    settings: () => spaceSettings.get(SPACE_SETTINGS_KEY),
    setSettings: (settings) =>
      serial(async () => {
        await spaceSettings.put(SPACE_SETTINGS_KEY, settings)
        emit({ kind: "settings" })
      }),
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
