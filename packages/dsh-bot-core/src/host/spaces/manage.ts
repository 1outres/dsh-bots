import {
  isSpaceSlug,
  SPACE_LIMITS,
  type SpaceIssuer,
  type SpaceRecord,
  type SpaceRevision,
  type SpaceVisibility,
  spaceIdOf,
} from "../../shared/spaces"
import type { FileTarget } from "../files"
import type { SpaceAccess, SpaceGrant, SpaceLinkGrant } from "./access"
import type { SpaceBlobs } from "./blobs"
import type { SpaceEvents } from "./events"
import type { SpaceKv } from "./kv"
import type { SpaceLive } from "./live"
import { SPACE_ENTRY, spaceDirectoryOf } from "./paths"
import { readSnapshot, type SnapshotFs } from "./snapshot"
import type { SpaceStore } from "./store"
import { STARTER_PAGE } from "./texts"

export class SpaceError extends Error {
  readonly code: "not-found" | "invalid" | "limit" | "unavailable"
  constructor(code: SpaceError["code"], message: string) {
    super(message)
    this.name = "SpaceError"
    this.code = code
  }
}

export interface SpaceWorkspaceFs extends SnapshotFs {
  writeText(
    target: FileTarget,
    content: string,
    expected: { readonly kind: "createIfAbsent" },
    signal?: AbortSignal,
  ): Promise<unknown>
}

export interface SpacePlace {
  readonly fs: SpaceWorkspaceFs
  readonly workspace: string
}

export interface SpaceCreation {
  readonly slug: string
  readonly title: string
  readonly description: string
  readonly pinned: boolean
}

export type SpacePublication =
  | {
      readonly ok: true
      readonly revision: number
      readonly files: number
      readonly bytes: number
      readonly viewers: number
    }
  | { readonly ok: false; readonly violations: readonly string[] }

export interface SpaceManagerDeps {
  readonly store: SpaceStore
  readonly blobs: SpaceBlobs
  readonly access: SpaceAccess
  readonly live: SpaceLive
  readonly events: Pick<SpaceEvents, "discard">
  readonly kv: Pick<SpaceKv, "forget">
  place(botId: string): SpacePlace | undefined
  now(): number
  warn(message: string): void
}

export interface SpaceManager {
  get(botId: string, slug: string): SpaceRecord
  create(
    botId: string,
    creation: SpaceCreation,
    signal: AbortSignal,
  ): Promise<{ readonly space: SpaceRecord; readonly starter: boolean }>
  publish(botId: string, slug: string, signal: AbortSignal): Promise<SpacePublication>
  update(
    spaceId: string,
    change: Partial<Pick<SpaceRecord, "title" | "description" | "pinned">>,
  ): Promise<SpaceRecord>
  setVisibility(
    spaceId: string,
    visibility: SpaceVisibility,
    issuedBy: SpaceIssuer,
  ): Promise<{ readonly space: SpaceRecord; readonly token: string | undefined }>
  setVisitorWrites(spaceId: string, allowed: boolean): Promise<SpaceRecord>
  link(spaceId: string, grant: SpaceLinkGrant): Promise<SpaceGrant>
  revokeLink(spaceId: string, linkId: string): Promise<boolean>
  discard(spaceId: string): Promise<boolean>
  forget(keep: (botId: string) => boolean): Promise<void>
  collect(): Promise<void>
}

const MIB = 1024 * 1024

export function createSpaceManager(deps: SpaceManagerDeps): SpaceManager {
  const { store, blobs, access, live } = deps
  let chain: Promise<unknown> = Promise.resolve()
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work)
    chain = next.catch(() => {})
    return next
  }

  const require = (spaceId: string) => {
    const space = store.get(spaceId)
    if (space === undefined) throw new SpaceError("not-found", "no such space")
    return space
  }

  const placeOf = (botId: string) => {
    const place = deps.place(botId)
    if (place === undefined) {
      throw new SpaceError(
        "unavailable",
        "your environment is not available right now; try again soon",
      )
    }
    return place
  }

  const collect = async () => {
    await blobs.collect(store.referencedBlobs())
  }

  const closeStreams = (spaceId: string, which: (viewer: string) => boolean) =>
    live.close((subscriber) => subscriber.spaceId === spaceId && which(subscriber.viewer))

  const discardOne = async (space: SpaceRecord) => {
    const spaceId = spaceIdOf(space.botId, space.slug)
    await deps.events.discard(spaceId, "all")
    closeStreams(spaceId, () => true)
    access.forgetFrames(spaceId)
    deps.kv.forget(spaceId)
  }

  const spaceOf = (botId: string, slug: string) => {
    if (!isSpaceSlug(slug)) throw new SpaceError("not-found", "no such space")
    return require(spaceIdOf(botId, slug))
  }

  return {
    get: spaceOf,
    async create(botId, creation, signal) {
      if (!isSpaceSlug(creation.slug)) {
        throw new SpaceError(
          "invalid",
          "space must be 1-40 lowercase letters, digits and '-', starting with a letter or digit",
        )
      }
      const spaceId = spaceIdOf(botId, creation.slug)
      if (store.get(spaceId) !== undefined) {
        throw new SpaceError("invalid", `you already have a Space "${creation.slug}"`)
      }
      if (store.list(botId).length >= SPACE_LIMITS.spacesPerBot) {
        throw new SpaceError(
          "limit",
          `you have ${SPACE_LIMITS.spacesPerBot} Spaces, the most a bot may have; delete one first`,
        )
      }
      const place = placeOf(botId)
      const entry = `${spaceDirectoryOf(creation.slug)}/${SPACE_ENTRY}`
      let starter = false
      if ((await place.fs.lstat(entry, { cwd: place.workspace }, signal)) === undefined) {
        const target = await place.fs.resolve(entry, { cwd: place.workspace, signal })
        await place.fs.writeText(
          target,
          STARTER_PAGE(creation.title),
          { kind: "createIfAbsent" },
          signal,
        )
        starter = true
      }
      const now = deps.now()
      const space: SpaceRecord = {
        botId,
        slug: creation.slug,
        title: creation.title,
        description: creation.description,
        pinned: creation.pinned,
        visibility: "owner",
        visitorWrites: false,
        source: { kind: "snapshot", revision: null },
        createdAt: now,
        updatedAt: now,
      }
      await store.create(space)
      return { space, starter }
    },
    async publish(botId, slug, signal) {
      spaceOf(botId, slug)
      const spaceId = spaceIdOf(botId, slug)
      const place = placeOf(botId)
      const snapshot = await readSnapshot(place.fs, place.workspace, slug, signal)
      if (!snapshot.ok) return snapshot
      return serial(async () => {
        require(spaceId)
        const own = new Map<string, number>()
        for (const other of store.list(botId)) {
          const revisions = store.revisions(spaceIdOf(botId, other.slug))
          const kept =
            other.slug === slug ? revisions.slice(0, SPACE_LIMITS.revisionsKept - 1) : revisions
          for (const revision of kept) {
            for (const file of Object.values(revision.files)) own.set(file.blob, file.bytes)
          }
        }
        const files: Record<string, SpaceRevision["files"][string]> = {}
        for (const file of snapshot.files) {
          const blob = blobs.hashOf(file.data)
          own.set(blob, file.data.length)
          files[file.path] = { blob, bytes: file.data.length, type: file.type }
        }
        const total = [...own.values()].reduce((sum, bytes) => sum + bytes, 0)
        if (total > SPACE_LIMITS.blobBytesPerBot) {
          return {
            ok: false as const,
            violations: [
              `your Spaces would keep ${Math.ceil(total / MIB)} MiB, more than ${SPACE_LIMITS.blobBytesPerBot / MIB} MiB per bot; make files smaller or delete Spaces`,
            ],
          }
        }
        for (const file of snapshot.files) await blobs.put(file.data)
        const number = (store.revisions(spaceId)[0]?.number ?? 0) + 1
        const at = deps.now()
        await store.publish(spaceId, { number, publishedAt: at, files }, at)
        await collect()
        const viewers = live.publish(spaceId, { event: "revision", data: { number } })
        return {
          ok: true as const,
          revision: number,
          files: snapshot.files.length,
          bytes: snapshot.bytes,
          viewers,
        }
      })
    },
    update: (spaceId, change) => {
      require(spaceId)
      return store.update(spaceId, change, deps.now())
    },
    async setVisibility(spaceId, visibility, issuedBy) {
      const space = require(spaceId)
      if (visibility === "public") {
        const next =
          space.visibility === "public"
            ? space
            : await store.update(spaceId, { visibility }, deps.now())
        const grant = await access.publish(spaceId, issuedBy)
        return { space: next, token: grant.token }
      }
      await access.unpublish(spaceId)
      const next =
        space.visibility === "owner"
          ? space
          : await store.update(spaceId, { visibility }, deps.now())
      closeStreams(spaceId, (viewer) => viewer === "public")
      await deps.events.discard(spaceId, "public")
      return { space: next, token: undefined }
    },
    async setVisitorWrites(spaceId, allowed) {
      const space = require(spaceId)
      return space.visitorWrites === allowed
        ? space
        : store.update(spaceId, { visitorWrites: allowed }, deps.now())
    },
    link(spaceId, grant) {
      require(spaceId)
      return access.link(spaceId, grant)
    },
    async revokeLink(spaceId, linkId) {
      require(spaceId)
      const revoked = await access.revokeLink(spaceId, linkId)
      live.close(
        (subscriber) => subscriber.spaceId === spaceId && !access.stillValid(subscriber.access),
      )
      return revoked
    },
    discard: (spaceId) =>
      serial(async () => {
        const space = store.get(spaceId)
        if (space === undefined) return false
        await discardOne(space)
        await store.discard(spaceId)
        await collect()
        return true
      }),
    forget: (keep) =>
      serial(async () => {
        const gone = store.list().filter((space) => !keep(space.botId))
        if (gone.length === 0) return
        for (const space of gone) await discardOne(space)
        await store.forget(keep)
        await collect()
      }),
    collect: () => serial(collect),
  }
}
