import type { ConnectorWaitingSnapshot } from "../../shared/connectors"
import { createStore, type Observable } from "../observable"
import type { RemoteMount } from "../remote"
import { followStream } from "./follow"

/** Pending connector actions per bot, as the bot rows mark them. */
export interface WaitingStore extends Observable<Readonly<Record<string, number>>> {
  dispose(): void
}

const NONE: Readonly<Record<string, number>> = {}

/** Follow `botConnectorActions.watchWaiting`; the last counts stay while it reconnects. */
export function watchWaiting(
  mount: Promise<RemoteMount>,
  generation: Observable<object | undefined>,
): WaitingStore {
  const state = createStore<Readonly<Record<string, number>>>(NONE)
  let disposed = false
  let stop: (() => void) | undefined
  void mount.then((mounted) => {
    if (disposed || mounted.status === "failed") return
    const remote = mounted.remote.botConnectorActions
    stop = followStream({
      generation,
      open: () => remote.watchWaiting(),
      item: (snapshot: ConnectorWaitingSnapshot) => state.set(snapshot.waiting),
      lost: () => {},
    })
  })
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    dispose() {
      disposed = true
      stop?.()
    },
  }
}
