import {
  linkIdOf,
  SPACE_LIMITS,
  SPACE_TOKEN,
  type SpaceAccessKind,
  type SpaceAccessRecord,
  type SpaceIssuer,
  type SpaceRecord,
  type SpaceViewer,
  spaceViewerOf,
} from "../../shared/spaces"
import type { SpaceStore } from "./store"

export interface SpaceGrant {
  readonly token: string
  readonly hash: string
  readonly expiresAt: number | null
}

export interface ResolvedAccess {
  readonly spaceId: string
  readonly space: SpaceRecord
  readonly kind: SpaceAccessKind
  readonly viewer: SpaceViewer
  readonly hash: string
}

export interface SpaceLinkGrant {
  readonly label: string
  readonly days: number
  readonly reason: string | null
  readonly issuedBy: SpaceIssuer
}

export interface SpaceAccess {
  frame(spaceId: string): SpaceGrant
  link(spaceId: string, grant: SpaceLinkGrant): Promise<SpaceGrant>
  publish(spaceId: string, issuedBy: SpaceIssuer): Promise<SpaceGrant>
  unpublish(spaceId: string): Promise<readonly string[]>
  revokeLink(spaceId: string, linkId: string): Promise<boolean>
  resolve(token: string): ResolvedAccess | undefined
  stillValid(hash: string): boolean
  links(spaceId: string): readonly (readonly [string, SpaceAccessRecord])[]
  publicToken(spaceId: string): string | undefined
  forgetFrames(spaceId: string): void
}

export interface SpaceAccessDeps {
  readonly store: Pick<SpaceStore, "get" | "access" | "accesses" | "grant" | "revoke">
  randomToken(): string
  sha256(text: string): string
  now(): number
}

interface FrameGrant {
  readonly spaceId: string
  readonly expiresAt: number
}

const DAY_MS = 24 * 60 * 60_000

export function createSpaceAccess(deps: SpaceAccessDeps): SpaceAccess {
  const frames = new Map<string, FrameGrant>()

  const mintSpaceToken = () => {
    const token = deps.randomToken()
    if (!SPACE_TOKEN.test(token))
      throw new Error("a space token must be 32 random bytes in base64url")
    return { token, hash: deps.sha256(token) }
  }

  const live = (record: SpaceAccessRecord, now: number) =>
    record.revokedAt === null && (record.expiresAt === null || record.expiresAt > now)

  const pruneFrames = (now: number) => {
    for (const [hash, frame] of frames) if (frame.expiresAt <= now) frames.delete(hash)
  }

  const activeOf = (spaceId: string, kind: "link" | "public") => {
    const now = deps.now()
    return deps.store
      .accesses(spaceId)
      .filter(([, record]) => record.kind === kind && live(record, now))
  }

  const resolveHash = (hash: string): ResolvedAccess | undefined => {
    const now = deps.now()
    const frame = frames.get(hash)
    if (frame !== undefined) {
      if (frame.expiresAt <= now) {
        frames.delete(hash)
        return undefined
      }
      const space = deps.store.get(frame.spaceId)
      return space === undefined
        ? undefined
        : { spaceId: frame.spaceId, space, kind: "frame", viewer: "owner", hash }
    }
    const record = deps.store.access(hash)
    if (record === undefined || !live(record, now)) return undefined
    const space = deps.store.get(record.spaceId)
    if (space === undefined) return undefined
    if (record.kind === "public" && space.visibility !== "public") return undefined
    return {
      spaceId: record.spaceId,
      space,
      kind: record.kind,
      viewer: spaceViewerOf(record.kind),
      hash,
    }
  }

  return {
    frame(spaceId) {
      const now = deps.now()
      pruneFrames(now)
      const { token, hash } = mintSpaceToken()
      const expiresAt = now + SPACE_LIMITS.frameMs
      frames.set(hash, { spaceId, expiresAt })
      return { token, hash, expiresAt }
    },
    async link(spaceId, grant) {
      const now = deps.now()
      const { token, hash } = mintSpaceToken()
      const expiresAt = now + grant.days * DAY_MS
      await deps.store.grant(hash, {
        spaceId,
        kind: "link",
        label: grant.label,
        reason: grant.reason,
        issuedBy: grant.issuedBy,
        createdAt: now,
        expiresAt,
        revokedAt: null,
        token: null,
      })
      return { token, hash, expiresAt }
    },
    async publish(spaceId, issuedBy) {
      const current = activeOf(spaceId, "public")[0]
      if (current !== undefined && current[1].token !== null) {
        return { token: current[1].token, hash: current[0], expiresAt: null }
      }
      const { token, hash } = mintSpaceToken()
      await deps.store.grant(hash, {
        spaceId,
        kind: "public",
        label: "public",
        reason: null,
        issuedBy,
        createdAt: deps.now(),
        expiresAt: null,
        revokedAt: null,
        token,
      })
      return { token, hash, expiresAt: null }
    },
    async unpublish(spaceId) {
      const hashes = activeOf(spaceId, "public").map(([hash]) => hash)
      await deps.store.revoke(hashes, deps.now())
      return hashes
    },
    async revokeLink(spaceId, linkId) {
      const match = activeOf(spaceId, "link").find(([hash]) => linkIdOf(hash) === linkId)
      if (match === undefined) return false
      await deps.store.revoke([match[0]], deps.now())
      return true
    },
    resolve(token) {
      if (!SPACE_TOKEN.test(token)) return undefined
      return resolveHash(deps.sha256(token))
    },
    stillValid: (hash) => resolveHash(hash) !== undefined,
    links: (spaceId) => activeOf(spaceId, "link"),
    publicToken(spaceId) {
      const space = deps.store.get(spaceId)
      if (space?.visibility !== "public") return undefined
      return activeOf(spaceId, "public")[0]?.[1].token ?? undefined
    },
    forgetFrames(spaceId) {
      for (const [hash, frame] of frames) if (frame.spaceId === spaceId) frames.delete(hash)
    },
  }
}
