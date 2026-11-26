import type { BotSpaceFrame } from "../../shared/spaces"
import { createStore, type Observable } from "../observable"
import { SpaceRequestError, type SpacesFailure } from "./feed"
import { frameRefreshDelay } from "./model"

export type SpaceFrameState =
  | { readonly status: "unpublished" }
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly url: string; readonly load: number }
  | { readonly status: "failed"; readonly failure: SpacesFailure }

export interface SpaceFrameDeps {
  fetch(): Promise<BotSpaceFrame>
  readonly revision: Observable<number | null>
  readonly generation: Observable<object | undefined>
  now(): number
  later(ms: number, run: () => void): () => void
}

export interface SpaceFrame extends Observable<SpaceFrameState> {
  retry(): void
  dispose(): void
}

export const failureOf = (error: unknown): SpacesFailure =>
  error instanceof SpaceRequestError
    ? error.failure
    : { kind: "connection", message: error instanceof Error ? error.message : String(error) }

export function createSpaceFrame(deps: SpaceFrameDeps): SpaceFrame {
  const state = createStore<SpaceFrameState>({ status: "loading" })
  let attempt = 0
  let loads = 0
  let disposed = false
  let cancelRefresh: (() => void) | undefined
  let revision = deps.revision.getSnapshot()
  let generation = deps.generation.getSnapshot()

  const stopRefresh = () => {
    cancelRefresh?.()
    cancelRefresh = undefined
  }

  const request = () => {
    stopRefresh()
    const mine = ++attempt
    if (state.getSnapshot().status !== "ready") state.set({ status: "loading" })
    deps.fetch().then(
      (frame) => {
        if (disposed || mine !== attempt) return
        loads += 1
        state.set({ status: "ready", url: frame.url, load: loads })
        cancelRefresh = deps.later(frameRefreshDelay(frame.expiresAt, deps.now()), request)
      },
      (error: unknown) => {
        if (disposed || mine !== attempt) return
        state.set({ status: "failed", failure: failureOf(error) })
      },
    )
  }

  const reload = () => {
    const current = state.getSnapshot()
    if (current.status !== "ready") {
      request()
      return
    }
    loads += 1
    state.set({ ...current, load: loads })
  }

  const offRevision = deps.revision.subscribe(() => {
    const next = deps.revision.getSnapshot()
    if (next === revision) return
    revision = next
    if (next === null) {
      stopRefresh()
      attempt += 1
      state.set({ status: "unpublished" })
      return
    }
    reload()
  })
  const offGeneration = deps.generation.subscribe(() => {
    const next = deps.generation.getSnapshot()
    if (next === undefined || next === generation) return
    generation = next
    if (revision !== null) request()
  })

  if (revision === null) state.set({ status: "unpublished" })
  else request()

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    retry: () => {
      if (revision !== null) request()
    },
    dispose() {
      disposed = true
      stopRefresh()
      offRevision()
      offGeneration()
    },
  }
}
