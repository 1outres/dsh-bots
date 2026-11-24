import type {
  BotWebCapability,
  BotWebSecretChange,
  BotWebTestResult,
  BotWebView,
} from "../../shared/web"
import { createStore, type Observable } from "../observable"
import type { BotWebRemote, RemoteMount } from "../remote"
import type { RemoteResult, StreamHandle } from "../types"

/** Why the web lookup settings cannot be read or changed. */
export type WebLookupFailure =
  | { readonly kind: "mount"; readonly message: string }
  | { readonly kind: "connection"; readonly message: string }
  | { readonly kind: "refused"; readonly code?: string; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }

export class WebLookupError extends Error {
  override readonly name = "WebLookupError"
  constructor(readonly failure: WebLookupFailure) {
    super(failure.message)
  }
}

export type WebLookupState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: BotWebView }
  | { readonly status: "failed"; readonly failure: WebLookupFailure }

/**
 * The web lookup settings of every bot, streamed while anything subscribes
 * (the section and the badges share one stream). Every change rejects with a
 * {@link WebLookupError}.
 */
export interface WebLookupFeed extends Observable<WebLookupState> {
  setEnabled(capability: BotWebCapability, enabled: boolean): Promise<BotWebView>
  setSecret(key: string, change: BotWebSecretChange): Promise<BotWebView>
  test(): Promise<BotWebTestResult>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function webOf(mount: Promise<RemoteMount>): Promise<BotWebRemote> {
  const mounted = await mount
  if (mounted.status === "failed") {
    throw new WebLookupError({ kind: "mount", message: mounted.error })
  }
  return mounted.remote.botWeb
}

const failureOf = (error: unknown): WebLookupFailure =>
  error instanceof WebLookupError
    ? error.failure
    : { kind: "connection", message: messageOf(error) }

export function createWebLookupFeed(mount: Promise<RemoteMount>): WebLookupFeed {
  const state = createStore<WebLookupState>({ status: "loading" })
  let followers = 0
  let handle: StreamHandle<BotWebView> | undefined
  let generation = 0

  const follow = () => {
    const current = ++generation
    state.set({ status: "loading" })
    void (async () => {
      try {
        const web = await webOf(mount)
        if (current !== generation) return
        handle = web.watch()
        for await (const view of handle) {
          if (current !== generation) return
          state.set({ status: "ready", view })
        }
      } catch (error) {
        if (current === generation) state.set({ status: "failed", failure: failureOf(error) })
      }
    })()
  }
  const stop = () => {
    generation += 1
    handle?.dispose()
    handle = undefined
  }

  const call = async <T>(run: (web: BotWebRemote) => Promise<RemoteResult<T>>): Promise<T> => {
    const web = await webOf(mount)
    let result: RemoteResult<T>
    try {
      result = await run(web)
    } catch (error) {
      throw new WebLookupError({ kind: "connection", message: messageOf(error) })
    }
    if (result.ok) return result.value
    const { code, message } = result.error
    throw new WebLookupError(
      message === undefined
        ? { kind: "protocol", message: "a refusal without a message" }
        : { kind: "refused", ...(code === undefined ? {} : { code }), message },
    )
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
    setEnabled: (capability, enabled) => call((web) => web.setEnabled(capability, enabled)),
    setSecret: (key, change) => call((web) => web.setSecret(key, change)),
    test: () => call((web) => web.test()),
  }
}
