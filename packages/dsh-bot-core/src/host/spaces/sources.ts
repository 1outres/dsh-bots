import { type SpaceRecord, spaceIdOf } from "../../shared/spaces"
import type { SpaceContentRequest, SpaceContentResult, SpaceSource } from "../../spaces-contract"
import type { SpaceBlobs } from "./blobs"
import type { SpaceStore } from "./store"

export interface SpaceSources {
  register(source: SpaceSource): () => void
  serve(request: SpaceContentRequest): Promise<SpaceContentResult>
  subscribe(space: SpaceRecord, listener: () => void): () => void
}

export function createSpaceSources(): SpaceSources {
  const sources = new Map<string, SpaceSource>()
  return {
    register(source) {
      if (sources.has(source.kind)) {
        throw new Error(`a space source of kind "${source.kind}" is already registered`)
      }
      sources.set(source.kind, source)
      return () => {
        if (sources.get(source.kind) === source) sources.delete(source.kind)
      }
    },
    serve(request) {
      const source = sources.get(request.space.source.kind)
      if (source === undefined) {
        return Promise.resolve({
          kind: "unavailable",
          reason: `no space source of kind "${request.space.source.kind}" is registered`,
        })
      }
      return source.serve(request)
    },
    subscribe(space, listener) {
      const source = sources.get(space.source.kind)
      return source === undefined ? () => {} : source.subscribe(space, listener)
    },
  }
}

export const etagOf = (blob: string) => `"${blob}"`

export function createSnapshotSource(deps: {
  readonly store: Pick<SpaceStore, "get" | "revision" | "subscribe">
  readonly blobs: Pick<SpaceBlobs, "open">
}): SpaceSource<"snapshot"> {
  return {
    kind: "snapshot",
    async serve({ space, path, method, ifNoneMatch }) {
      const number = space.source.revision
      if (number === null) return { kind: "not-found" }
      const revision = deps.store.revision(spaceIdOf(space.botId, space.slug), number)
      const file = revision?.files[path]
      if (file === undefined) return { kind: "not-found" }
      const etag = etagOf(file.blob)
      if (ifNoneMatch?.split(",").some((tag) => tag.trim() === etag)) {
        return { kind: "not-modified", etag }
      }
      return {
        kind: "body",
        type: file.type,
        etag,
        bytes: file.bytes,
        body: method === "HEAD" ? null : deps.blobs.open(file.blob),
      }
    },
    subscribe(space, listener) {
      const spaceId = spaceIdOf(space.botId, space.slug)
      let revision = deps.store.get(spaceId)?.source.revision ?? null
      return deps.store.subscribe((change) => {
        if (change.kind !== "space" || change.spaceId !== spaceId) return
        const next = deps.store.get(spaceId)?.source.revision ?? null
        if (next === revision) return
        revision = next
        listener()
      })
    },
  }
}
