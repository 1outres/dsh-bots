import { createStore, type Observable } from "./observable"
import type { RemoteMount } from "./remote"
import type { RemoteResult, StreamHandle } from "./types"

export type FeedState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly value: T }
  | { readonly status: "failed"; readonly message: string }

export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

/** The mounted Remote, or the reason it is not. */
export async function mountedRemote(mount: Promise<RemoteMount>) {
  const mounted = await mount
  if (mounted.status === "failed") throw new Error(mounted.error)
  return mounted.remote
}

/** A call's value, or a rejection with the Host's message. */
export function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message ?? "request refused")
  return result.value
}

/** An observable that follows `open`'s stream while it has subscribers. */
export function followed<R, T>(
  open: (remote: R) => StreamHandle<T>,
  remote: () => Promise<R>,
): Observable<FeedState<T>> {
  const state = createStore<FeedState<T>>({ status: "loading" })
  let followers = 0
  let handle: StreamHandle<T> | undefined
  let generation = 0
  const follow = () => {
    const current = ++generation
    state.set({ status: "loading" })
    void (async () => {
      try {
        const resolved = await remote()
        if (current !== generation) return
        handle = open(resolved)
        for await (const value of handle) {
          if (current !== generation) return
          state.set({ status: "ready", value })
        }
      } catch (error) {
        if (current === generation) state.set({ status: "failed", message: messageOf(error) })
      }
    })()
  }
  const stop = () => {
    generation += 1
    handle?.dispose()
    handle = undefined
  }
  return {
    getSnapshot: state.getSnapshot,
    subscribe(listener) {
      const off = state.subscribe(listener)
      followers += 1
      if (followers === 1) follow()
      return () => {
        off()
        followers -= 1
        if (followers === 0) stop()
      }
    },
  }
}
