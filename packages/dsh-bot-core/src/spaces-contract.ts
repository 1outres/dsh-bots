import type { SpaceRecord } from "./shared/spaces"

export interface SpaceContentRequest {
  readonly space: SpaceRecord
  readonly path: string
  readonly method: "GET" | "HEAD"
  readonly ifNoneMatch: string | undefined
  readonly signal: AbortSignal
}

export type SpaceContentResult =
  | {
      readonly kind: "body"
      readonly type: string
      readonly etag: string
      readonly bytes: number
      readonly body: ReadableStream<Uint8Array> | null
    }
  | { readonly kind: "not-modified"; readonly etag: string }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable"; readonly reason: string }

export interface SpaceSource<Kind extends string = string> {
  readonly kind: Kind
  serve(request: SpaceContentRequest): Promise<SpaceContentResult>
  subscribe(space: SpaceRecord, listener: () => void): () => void
}
