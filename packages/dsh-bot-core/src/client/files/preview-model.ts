import type { BotFileFailure } from "../file-failure"
import type { BotFilesClient } from "../files"
import { createStore, type Observable } from "../observable"
import {
  type ExtendDirection,
  extendPreview,
  loadPreview,
  type Preview,
  type PreviewRequest,
} from "./preview"
import { settle } from "./settle"

export type Extension =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly direction: ExtendDirection }
  | {
      readonly status: "failed"
      readonly direction: ExtendDirection
      readonly failure: BotFileFailure
    }

export type PreviewState =
  | { readonly status: "idle" }
  | { readonly status: "loading"; readonly request: PreviewRequest }
  | {
      readonly status: "ready"
      readonly request: PreviewRequest
      readonly preview: Preview
      readonly extension: Extension
    }
  | {
      readonly status: "failed"
      readonly request: PreviewRequest
      readonly failure: BotFileFailure
    }

export interface PreviewModel extends Observable<PreviewState> {
  load(request: PreviewRequest): void
  extend(direction: ExtendDirection): void
  cancel(): void
}

const IDLE: PreviewState = { status: "idle" }
const NOT_EXTENDING: Extension = { status: "idle" }

export function createPreviewModel(files: BotFilesClient, sessionId: string): PreviewModel {
  const state = createStore<PreviewState>(IDLE)
  let controller: AbortController | undefined

  const begin = (): AbortSignal => {
    controller?.abort()
    controller = new AbortController()
    return controller.signal
  }

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    load(request) {
      const signal = begin()
      state.set({ status: "loading", request })
      void settle(signal, (s) => loadPreview(files, sessionId, request, s)).then((outcome) => {
        switch (outcome.status) {
          case "aborted":
            return
          case "done":
            state.set({
              status: "ready",
              request,
              preview: outcome.value,
              extension: NOT_EXTENDING,
            })
            return
          case "failed":
            state.set({ status: "failed", request, failure: outcome.failure })
            return
        }
      })
    },
    extend(direction) {
      const current = state.getSnapshot()
      if (current.status !== "ready" || current.extension.status === "loading") return
      const { preview, request } = current
      if (preview.kind !== "text") return
      const signal = begin()
      state.set({ ...current, extension: { status: "loading", direction } })
      void settle(signal, (s) =>
        extendPreview(files, sessionId, request.path, preview, direction, s),
      ).then((outcome) => {
        switch (outcome.status) {
          case "aborted":
            return
          case "done":
            state.set({ ...current, preview: outcome.value, extension: NOT_EXTENDING })
            return
          case "failed":
            state.set({
              ...current,
              extension: { status: "failed", direction, failure: outcome.failure },
            })
            return
        }
      })
    },
    cancel() {
      controller?.abort()
      controller = undefined
      const current = state.getSnapshot()
      if (current.status === "loading") state.set(IDLE)
      else if (current.status === "ready" && current.extension.status === "loading") {
        state.set({ ...current, extension: NOT_EXTENDING })
      }
    },
  }
}
