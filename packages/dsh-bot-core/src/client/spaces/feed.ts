import {
  BOT_SPACE_ERROR_CODES,
  type BotSpaceDiscarded,
  type BotSpaceErrorCode,
  type BotSpaceFrame,
  type BotSpaceLinkCreated,
  type BotSpaceLinkRequest,
  type BotSpacesSettings,
  type BotSpacesView,
  type BotSpaceView,
  type SpaceVisibility,
} from "../../shared/spaces"
import { followStream } from "../approvals/follow"
import { createStore, type Observable } from "../observable"
import type { BotSpacesRemote, RemoteMount } from "../remote"
import type { RemoteResult } from "../types"

export const SPACE_REQUEST_CODES = [...BOT_SPACE_ERROR_CODES, "gateway/bad-request"] as const

export type SpaceRequestCode = BotSpaceErrorCode | "gateway/bad-request"

export type SpacesFailure =
  | { readonly kind: "mount"; readonly message: string }
  | { readonly kind: "connection"; readonly message: string }
  | { readonly kind: "refused"; readonly code: SpaceRequestCode; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }

export class SpaceRequestError extends Error {
  override readonly name = "SpaceRequestError"
  constructor(readonly failure: SpacesFailure) {
    super(failure.message)
  }
}

export type SpacesState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly view: BotSpacesView }
  | { readonly status: "reconnecting"; readonly view: BotSpacesView }
  | { readonly status: "unavailable"; readonly message: string }
  | { readonly status: "failed"; readonly message: string }

export const spacesViewOf = (state: SpacesState): BotSpacesView | undefined =>
  state.status === "ready" || state.status === "reconnecting" ? state.view : undefined

export interface SpacesApi {
  frame(spaceId: string): Promise<BotSpaceFrame>
  setPinned(spaceId: string, pinned: boolean): Promise<BotSpaceView>
  setVisibility(spaceId: string, visibility: SpaceVisibility): Promise<BotSpaceView>
  setVisitorWrites(spaceId: string, allowed: boolean): Promise<BotSpaceView>
  createLink(spaceId: string, request: BotSpaceLinkRequest): Promise<BotSpaceLinkCreated>
  revokeLink(spaceId: string, linkId: string): Promise<BotSpaceView>
  discard(spaceId: string): Promise<BotSpaceDiscarded>
  setPublicBaseUrl(url: string | null): Promise<BotSpacesSettings>
}

export interface SpacesFeed extends Observable<SpacesState>, SpacesApi {
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isRequestCode = (code: string | undefined): code is SpaceRequestCode =>
  (SPACE_REQUEST_CODES as readonly (string | undefined)[]).includes(code)

export function refusalOf(error: {
  readonly code?: string
  readonly message?: string
}): SpacesFailure {
  const { code, message } = error
  if (message === undefined) return { kind: "protocol", message: "a refusal without a message" }
  if (!isRequestCode(code)) {
    return {
      kind: "protocol",
      message: `an unknown refusal ${code ?? "without a code"}: ${message}`,
    }
  }
  return { kind: "refused", code, message }
}

export function watchSpaces(
  mount: Promise<RemoteMount>,
  generation: Observable<object | undefined>,
): SpacesFeed {
  const state = createStore<SpacesState>({ status: "loading" })
  let disposed = false
  let stop: (() => void) | undefined
  const face = mount.then((mounted) => {
    if (mounted.status === "failed") {
      throw new SpaceRequestError({ kind: "mount", message: mounted.error })
    }
    return mounted.remote.botSpaces
  })
  void face.then(
    (remote) => {
      if (disposed) return
      stop = followStream({
        generation,
        open: () => remote.watch(),
        item: (view: BotSpacesView) => state.set({ status: "ready", view }),
        lost: (message) => {
          const current = state.getSnapshot()
          const view = spacesViewOf(current)
          state.set(
            view === undefined
              ? { status: "unavailable", message: message ?? "the Spaces stream ended" }
              : { status: "reconnecting", view },
          )
        },
      })
    },
    (error: unknown) => {
      if (!disposed) state.set({ status: "failed", message: messageOf(error) })
    },
  )

  const call = async <T>(run: (remote: BotSpacesRemote) => Promise<RemoteResult<T>>) => {
    const remote = await face
    let result: RemoteResult<T>
    try {
      result = await run(remote)
    } catch (error) {
      throw new SpaceRequestError({ kind: "connection", message: messageOf(error) })
    }
    if (result.ok) return result.value
    const failure = refusalOf(result.error)
    if (failure.kind === "protocol")
      console.error("bot-core: a Spaces request failed", result.error)
    throw new SpaceRequestError(failure)
  }

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    frame: (spaceId) => call((remote) => remote.frame(spaceId)),
    setPinned: (spaceId, pinned) => call((remote) => remote.setPinned(spaceId, pinned)),
    setVisibility: (spaceId, visibility) =>
      call((remote) => remote.setVisibility(spaceId, visibility)),
    setVisitorWrites: (spaceId, allowed) =>
      call((remote) => remote.setVisitorWrites(spaceId, allowed)),
    createLink: (spaceId, request) => call((remote) => remote.createLink(spaceId, request)),
    revokeLink: (spaceId, linkId) => call((remote) => remote.revokeLink(spaceId, linkId)),
    discard: (spaceId) => call((remote) => remote.discard(spaceId)),
    setPublicBaseUrl: (url) => call((remote) => remote.setPublicBaseUrl(url)),
    dispose() {
      disposed = true
      stop?.()
    },
  }
}
