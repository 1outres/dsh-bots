import type {
  BotConnectionsSnapshot,
  ConnectionAuthorization,
  ConnectionAuthorizeRequest,
  ConnectionProviderView,
  ConnectionRemoval,
  ConnectionView,
  OAuthClientChange,
} from "../shared/connections"
import { createFeedHub } from "./feed-hub"
import { createStore, type Observable } from "./observable"
import type { BotConnectionsRemote, RemoteMount } from "./remote"
import type { RemoteResult, StreamHandle } from "./types"

export type ConnectionsFailure =
  | { readonly kind: "mount"; readonly message: string }
  | { readonly kind: "connection"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }

export class ConnectionsError extends Error {
  override readonly name = "ConnectionsError"
  constructor(readonly failure: ConnectionsFailure) {
    super(failure.message)
  }
}

export type ConnectionsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: BotConnectionsSnapshot }
  | { readonly status: "failed"; readonly failure: ConnectionsFailure }

export interface ConnectionsOperations {
  configureClient(provider: string, change: OAuthClientChange): Promise<ConnectionProviderView>
  authorize(request: ConnectionAuthorizeRequest): Promise<ConnectionAuthorization>
  rename(connectionId: string, label: string): Promise<ConnectionView>
  assign(botId: string, connectionId: string, assigned: boolean): Promise<ConnectionView>
  disconnect(connectionId: string): Promise<ConnectionRemoval>
}

export interface ConnectionsModel extends Observable<ConnectionsState>, ConnectionsOperations {
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function connectionsOf(mount: Promise<RemoteMount>): Promise<BotConnectionsRemote> {
  const mounted = await mount
  if (mounted.status === "failed")
    throw new ConnectionsError({ kind: "mount", message: mounted.error })
  return mounted.remote.botConnections
}

export function createConnectionsModel(mount: Promise<RemoteMount>): ConnectionsModel {
  const state = createStore<ConnectionsState>({ status: "loading" })
  let disposed = false
  let handle: StreamHandle<BotConnectionsSnapshot> | undefined
  void (async () => {
    try {
      const connections = await connectionsOf(mount)
      if (disposed) return
      handle = connections.watch()
      for await (const snapshot of handle) {
        if (disposed) return
        state.set({ status: "ready", snapshot })
      }
    } catch (error) {
      if (!disposed) {
        state.set({
          status: "failed",
          failure:
            error instanceof ConnectionsError
              ? error.failure
              : { kind: "connection", message: messageOf(error) },
        })
      }
    }
  })()
  const call = async <T>(
    run: (connections: BotConnectionsRemote) => Promise<RemoteResult<T>>,
  ): Promise<T> => {
    const connections = await connectionsOf(mount)
    let result: RemoteResult<T>
    try {
      result = await run(connections)
    } catch (error) {
      throw new ConnectionsError({ kind: "connection", message: messageOf(error) })
    }
    if (result.ok) return result.value
    const { message } = result.error
    throw new ConnectionsError(
      message === undefined
        ? { kind: "protocol", message: "a refusal without a message" }
        : { kind: "refused", message },
    )
  }
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    configureClient: (provider, change) =>
      call((remote) => remote.configureClient(provider, change)),
    authorize: (request) => call((remote) => remote.authorize(request)),
    rename: (connectionId, label) => call((remote) => remote.rename(connectionId, label)),
    assign: (botId, connectionId, assigned) =>
      call((remote) => remote.assign(botId, connectionId, assigned)),
    disconnect: (connectionId) => call((remote) => remote.disconnect(connectionId)),
    dispose() {
      disposed = true
      handle?.dispose()
    },
  }
}

export type ConnectionsFeed = Observable<ConnectionsState> & ConnectionsOperations

export function createConnectionsFeed(open: () => ConnectionsModel): ConnectionsFeed {
  const hub = createFeedHub<ConnectionsState, ConnectionsModel, ConnectionsOperations>({
    name: "connections",
    idle: { status: "loading" },
    open,
    extend: (followed) => ({
      configureClient: async (provider, change) => followed().configureClient(provider, change),
      authorize: async (request) => followed().authorize(request),
      rename: async (connectionId, label) => followed().rename(connectionId, label),
      assign: async (botId, connectionId, assigned) =>
        followed().assign(botId, connectionId, assigned),
      disconnect: async (connectionId) => followed().disconnect(connectionId),
    }),
  })
  return hub.feed("all")
}
