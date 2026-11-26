import type {
  BotChannelChange,
  BotChannelsSnapshot,
  BotChannelText,
  BotChannelView,
} from "../shared/channels"
import { createStore, type Observable } from "./observable"
import type { BotChannelsRemote, RemoteMount } from "./remote"
import type { StreamHandle } from "./types"

export type ChannelsFailure =
  | { readonly kind: "mount"; readonly message: string }
  | { readonly kind: "connection"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "protocol"; readonly message: string }
  | { readonly kind: "check"; readonly message: string; readonly reason: BotChannelText }

export const checkFailure = (reason: BotChannelText): ChannelsFailure => ({
  kind: "check",
  message: reason.en,
  reason,
})

export class ChannelsError extends Error {
  override readonly name = "ChannelsError"
  constructor(readonly failure: ChannelsFailure) {
    super(failure.message)
  }
}

export type ChannelsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: BotChannelsSnapshot }
  | { readonly status: "failed"; readonly failure: ChannelsFailure }

export interface ChannelsModel extends Observable<ChannelsState> {
  configure(channelId: string, change: BotChannelChange): Promise<BotChannelView>
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function channelsOf(mount: Promise<RemoteMount>): Promise<BotChannelsRemote> {
  const mounted = await mount
  if (mounted.status === "failed") {
    throw new ChannelsError({ kind: "mount", message: mounted.error })
  }
  return mounted.remote.botChannels
}

const failureOf = (error: unknown): ChannelsFailure =>
  error instanceof ChannelsError ? error.failure : { kind: "connection", message: messageOf(error) }

export function createChannelsModel(mount: Promise<RemoteMount>, botId: string): ChannelsModel {
  const state = createStore<ChannelsState>({ status: "loading" })
  let disposed = false
  let handle: StreamHandle<BotChannelsSnapshot> | undefined

  void (async () => {
    try {
      const channels = await channelsOf(mount)
      if (disposed) return
      handle = channels.watch(botId)
      for await (const snapshot of handle) {
        if (disposed) return
        state.set({ status: "ready", snapshot })
      }
    } catch (error) {
      if (!disposed) state.set({ status: "failed", failure: failureOf(error) })
    }
  })()

  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    async configure(channelId, change) {
      const channels = await channelsOf(mount)
      let result: Awaited<ReturnType<BotChannelsRemote["configure"]>>
      try {
        result = await channels.configure(botId, channelId, change)
      } catch (error) {
        throw new ChannelsError({ kind: "connection", message: messageOf(error) })
      }
      if (result.ok) {
        if (result.value.saved) return result.value.view
        throw new ChannelsError(checkFailure(result.value.reason))
      }
      const { message } = result.error
      throw new ChannelsError(
        message === undefined
          ? { kind: "protocol", message: "a refusal without a message" }
          : { kind: "refused", message },
      )
    },
    dispose() {
      disposed = true
      handle?.dispose()
    },
  }
}
