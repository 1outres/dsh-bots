import type {
  BotConnectorChange,
  BotConnectorsSnapshot,
  BotConnectorView,
  ConnectorPermissionChange,
} from "../shared/connectors"
import { followStream } from "./approvals/follow"
import { createStore, type Observable } from "./observable"
import type { BotConnectorsRemote, RemoteMount } from "./remote"
import type { RemoteResult } from "./types"

/** Why a bot's connectors cannot be read or changed. */
export type ConnectorsFailure =
  | { readonly kind: "mount"; readonly message: string }
  | { readonly kind: "connection"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }

export class ConnectorsError extends Error {
  override readonly name = "ConnectorsError"
  constructor(readonly failure: ConnectorsFailure) {
    super(failure.message)
  }
}

export type ConnectorsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: BotConnectorsSnapshot }
  | { readonly status: "failed"; readonly failure: ConnectorsFailure }

/** One bot's connectors, followed while its settings are open. Every change rejects with a {@link ConnectorsError}. */
export interface ConnectorsModel extends Observable<ConnectorsState> {
  configure(connectorId: string, change: BotConnectorChange): Promise<BotConnectorView>
  setPermission(change: ConnectorPermissionChange): Promise<BotConnectorView>
  retry(connectorId: string): Promise<BotConnectorView>
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function connectorsOf(mount: Promise<RemoteMount>): Promise<BotConnectorsRemote> {
  const mounted = await mount
  if (mounted.status === "failed") {
    throw new ConnectorsError({ kind: "mount", message: mounted.error })
  }
  return mounted.remote.botConnectors
}

const failureOf = (error: unknown): ConnectorsFailure =>
  error instanceof ConnectorsError
    ? error.failure
    : { kind: "connection", message: messageOf(error) }

export interface ConnectorsModelDeps {
  readonly mount: Promise<RemoteMount>
  /** The connection's generation: a lost stream reopens at once on a new one. */
  readonly generation: Observable<object | undefined>
}

/** A lost stream reopens with backoff; the last snapshot stays meanwhile. */
export function createConnectorsModel(deps: ConnectorsModelDeps, botId: string): ConnectorsModel {
  const { mount } = deps
  const state = createStore<ConnectorsState>({ status: "loading" })
  let disposed = false
  let stop: (() => void) | undefined

  void connectorsOf(mount).then(
    (connectors) => {
      if (disposed) return
      stop = followStream<BotConnectorsSnapshot>({
        generation: deps.generation,
        open: () => connectors.watch(botId),
        item: (snapshot) => state.set({ status: "ready", snapshot }),
        lost(message) {
          if (state.getSnapshot().status === "ready" || message === undefined) return
          state.set({ status: "failed", failure: { kind: "connection", message } })
        },
      })
    },
    (error: unknown) => {
      if (!disposed) state.set({ status: "failed", failure: failureOf(error) })
    },
  )

  const call = async (
    run: (connectors: BotConnectorsRemote) => Promise<RemoteResult<BotConnectorView>>,
  ): Promise<BotConnectorView> => {
    const connectors = await connectorsOf(mount)
    let result: RemoteResult<BotConnectorView>
    try {
      result = await run(connectors)
    } catch (error) {
      throw new ConnectorsError({ kind: "connection", message: messageOf(error) })
    }
    if (result.ok) return result.value
    const { message } = result.error
    throw new ConnectorsError(
      message === undefined
        ? { kind: "protocol", message: "a refusal without a message" }
        : { kind: "refused", message },
    )
  }

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    configure: (connectorId, change) =>
      call((connectors) => connectors.configure(botId, connectorId, change)),
    setPermission: (change) => call((connectors) => connectors.setPermission(botId, change)),
    retry: (connectorId) => call((connectors) => connectors.retry(botId, connectorId)),
    dispose() {
      disposed = true
      stop?.()
    },
  }
}
