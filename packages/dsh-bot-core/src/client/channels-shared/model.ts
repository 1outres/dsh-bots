import type {
  BotChannelSharedChange,
  BotChannelSharedSnapshot,
  BotChannelSharedView,
} from "../../shared/channels"
import { followStream } from "../approvals/follow"
import { askAbout, type ChannelAsk, type ChannelQueries } from "../channel-queries"
import { ChannelsError, type ChannelsFailure, checkFailure } from "../channels-model"
import { createStore, type Observable } from "../observable"
import type { BotChannelsRemote, RemoteMount } from "../remote"

export type SharedChannelsState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: BotChannelSharedSnapshot }
  | { readonly status: "failed"; readonly failure: ChannelsFailure }

export interface SharedChannelsFeed extends Observable<SharedChannelsState> {
  configure(channelId: string, change: BotChannelSharedChange): Promise<BotChannelSharedView>
  ask(channelId: string): ChannelAsk
  dispose(): void
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function channelsOf(mount: Promise<RemoteMount>): Promise<BotChannelsRemote> {
  const mounted = await mount
  if (mounted.status === "failed")
    throw new ChannelsError({ kind: "mount", message: mounted.error })
  return mounted.remote.botChannels
}

export interface SharedChannelsSources {
  readonly mount: Promise<RemoteMount>
  readonly generation: Observable<object | undefined>
  readonly queries: ChannelQueries
}

export function createSharedChannelsFeed(sources: SharedChannelsSources): SharedChannelsFeed {
  const { mount, queries } = sources
  const state = createStore<SharedChannelsState>({ status: "loading" })
  let disposed = false
  let stop: (() => void) | undefined
  channelsOf(mount).then(
    (channels) => {
      if (disposed) return
      stop = followStream({
        generation: sources.generation,
        open: () => channels.watchShared(),
        item: (snapshot: BotChannelSharedSnapshot) => state.set({ status: "ready", snapshot }),
        lost: (message) => {
          if (state.getSnapshot().status !== "ready") {
            state.set({
              status: "failed",
              failure: { kind: "connection", message: message ?? "the connection was lost" },
            })
          }
        },
      })
    },
    (error: unknown) => {
      if (!disposed) {
        state.set({
          status: "failed",
          failure:
            error instanceof ChannelsError
              ? error.failure
              : { kind: "connection", message: messageOf(error) },
        })
      }
    },
  )
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    async configure(channelId, change) {
      const channels = await channelsOf(mount)
      let result: Awaited<ReturnType<BotChannelsRemote["configureShared"]>>
      try {
        result = await channels.configureShared(channelId, change)
      } catch (error) {
        throw new ChannelsError({ kind: "connection", message: messageOf(error) })
      }
      if (!result.ok) {
        const { message } = result.error
        throw new ChannelsError(
          message === undefined
            ? { kind: "protocol", message: "a refusal without a message" }
            : { kind: "refused", message },
        )
      }
      if (result.value.saved) return result.value.view
      throw new ChannelsError(checkFailure(result.value.reason))
    },
    ask: (channelId) => askAbout(queries, channelId, () => ({ kind: "shared" })),
    dispose() {
      disposed = true
      stop?.()
    },
  }
}

export function sharedViewOf(
  state: SharedChannelsState,
  channelId: string,
): BotChannelSharedView | undefined {
  return state.status === "ready"
    ? state.snapshot.channels.find((view) => view.channel.id === channelId)
    : undefined
}
