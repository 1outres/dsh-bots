import { followStream } from "../approvals/follow"
import { createFeedHub, type FollowedModel } from "../feed-hub"
import { createStore, type Observable } from "../observable"
import { messageOf } from "../remote-feed"
import type { MainViewClient } from "./client"
import {
  applyFrame,
  earlierCursor,
  LOADING_TIMELINE,
  pageFailed,
  pageLoaded,
  pageLoading,
  streamLost,
  type TimelineState,
} from "./state"

export interface TimelineModel extends FollowedModel<TimelineState> {
  loadEarlier(): void
}

export function createTimelineModel(client: MainViewClient, botId: string): TimelineModel {
  const state = createStore<TimelineState>(LOADING_TIMELINE)
  let disposed = false
  let stop: (() => void) | undefined
  void client.watch(botId).then(
    (open) => {
      if (disposed) return
      stop = followStream({
        generation: client.generation,
        open,
        item: (frame) => state.set(applyFrame(state.getSnapshot(), frame)),
        lost: (message) => state.set(streamLost(state.getSnapshot(), message)),
      })
    },
    (error: unknown) => {
      if (!disposed) state.set({ status: "failed", message: messageOf(error) })
    },
  )
  return {
    getSnapshot: state.getSnapshot,
    subscribe: state.subscribe,
    loadEarlier() {
      const current = state.getSnapshot()
      const cursor = earlierCursor(current)
      if (cursor === undefined) return
      state.set(pageLoading(current, cursor))
      client.page(botId, cursor).then(
        (page) => state.set(pageLoaded(state.getSnapshot(), cursor, page)),
        (error: unknown) => state.set(pageFailed(state.getSnapshot(), cursor, messageOf(error))),
      )
    },
    dispose() {
      disposed = true
      stop?.()
    },
  }
}

export interface TimelineFeed extends Observable<TimelineState> {
  loadEarlier(): void
}

export interface TimelinesHub {
  feed(botId: string): TimelineFeed
}

export function createTimelinesHub(client: MainViewClient): TimelinesHub {
  return createFeedHub<TimelineState, TimelineModel, Pick<TimelineFeed, "loadEarlier">>({
    name: "Main timelines",
    idle: LOADING_TIMELINE,
    open: (botId) => createTimelineModel(client, botId),
    extend: (followed) => ({ loadEarlier: () => followed().loadEarlier() }),
  })
}
