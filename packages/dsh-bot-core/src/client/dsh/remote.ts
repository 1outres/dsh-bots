// Source: dsh-typert-protocol/src/types.ts, dsh-api-remotes (`ctx.remote`).

export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: {
        readonly code?: string
        readonly message?: string
        /** The structured payload of `code` (`RemoteErrorDetailsMap`). */
        readonly details?: unknown
      }
    }

export interface StreamHandle<T> extends AsyncIterable<T> {
  dispose(): void
}

/** typert `RemoteStreamHandle`: a stream the Client also sends items on. */
export interface DuplexStreamHandle<Out, In> extends StreamHandle<Out> {
  /** @throws once the stream ended, or for an item that is not JSON. */
  send(item: In): void
  end(): void
}

/** typert `TypertCodec`, strict mode. */
export interface RemoteCodec {
  readonly mode: "strict"
  readonly typeSymbol: string
  create(): { parse(value: unknown): unknown }
}

/** typert `InvocationParameterDescriptor`, JSON source. */
export interface RemoteParameterDescriptor {
  readonly name: string
  readonly wire: string
  readonly source: "json"
  readonly codec: RemoteCodec
}

/** typert `InvocationDescriptor`, direct invocation. */
export interface RemoteInvocationDescriptor {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly mode?: "stream"
  readonly invocation: { readonly kind: "direct" }
  readonly parameters: readonly RemoteParameterDescriptor[]
  readonly cancellation?: { readonly parameter: "signal" }
  readonly uplink?: { readonly codec: RemoteCodec }
  readonly result: RemoteCodec
}

/** typert `TypertRemoteContribution`: one per package. */
export interface RemoteContribution {
  readonly package: string
  readonly descriptors: readonly RemoteInvocationDescriptor[]
}

/** `ctx.remote` (dsh-api-remotes). */
export interface RemoteService {
  $mount(contribution: RemoteContribution): Promise<() => Promise<void>>
}
