import type {
  BotConnectorActionsSnapshot,
  ConnectorActionView,
  ConnectorDecision,
  ConnectorDecisionResult,
} from "../../shared/connectors"
import { createStore, type Observable } from "../observable"
import type { BotConnectorActionsRemote, RemoteMount } from "../remote"
import { followStream } from "./follow"

export type ActionsState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready"
      readonly actions: readonly ConnectorActionView[]
      readonly reconnecting: boolean
    }
  | { readonly status: "failed"; readonly message: string }

export type DecisionOutcome =
  | { readonly kind: "result"; readonly result: ConnectorDecisionResult }
  | { readonly kind: "unreachable"; readonly message: string }

export interface ActionsModel extends Observable<ActionsState> {
  decide(actionId: string, decision: ConnectorDecision): Promise<DecisionOutcome>
  dispose(): void
}

export interface ActionsModelDeps {
  readonly mount: Promise<RemoteMount>
  readonly generation: Observable<object | undefined>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createActionsModel(deps: ActionsModelDeps, botId: string): ActionsModel {
  const state = createStore<ActionsState>({ status: "loading" })
  let disposed = false
  let stop: (() => void) | undefined
  let face: BotConnectorActionsRemote | undefined

  const ready = (snapshot: BotConnectorActionsSnapshot) =>
    state.set({ status: "ready", actions: snapshot.actions, reconnecting: false })

  void deps.mount.then((mounted) => {
    if (disposed) return
    if (mounted.status === "failed") {
      state.set({ status: "failed", message: mounted.error })
      return
    }
    const remote = mounted.remote.botConnectorActions
    face = remote
    stop = followStream({
      generation: deps.generation,
      open: () => remote.watch(botId),
      item: ready,
      lost(message) {
        const current = state.getSnapshot()
        if (current.status === "ready") state.set({ ...current, reconnecting: true })
        else if (message !== undefined) state.set({ status: "failed", message })
      },
    })
  })

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    async decide(actionId, decision) {
      if (face === undefined) return { kind: "unreachable", message: "not connected yet" }
      try {
        const result = await face.decide(botId, actionId, decision)
        return result.ok
          ? { kind: "result", result: result.value }
          : { kind: "unreachable", message: result.error.message ?? "the decision was refused" }
      } catch (error) {
        return { kind: "unreachable", message: messageOf(error) }
      }
    },
    dispose() {
      disposed = true
      stop?.()
    },
  }
}
