export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false
      readonly error: {
        readonly code?: string
        readonly message?: string
        readonly details?: unknown
      }
    }

export interface StreamHandle<T> extends AsyncIterable<T> {
  dispose(): void
}

export interface DuplexStreamHandle<Out, In> extends StreamHandle<Out> {
  send(item: In): void
  end(): void
}

export interface RemoteCodec {
  readonly mode: "strict"
  readonly typeSymbol: string
  create(): { parse(value: unknown): unknown }
}

export interface RemoteParameterDescriptor {
  readonly name: string
  readonly wire: string
  readonly source: "json"
  readonly codec: RemoteCodec
}

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

export interface RemoteContribution {
  readonly package: string
  readonly descriptors: readonly RemoteInvocationDescriptor[]
}

export interface RemoteService {
  $mount(contribution: RemoteContribution): Promise<() => Promise<void>>
}
