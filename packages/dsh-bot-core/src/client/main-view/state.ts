import type {
  MainTimelineCursor,
  MainTimelineFrame,
  MainTimelineItem,
  MainTimelinePage,
} from "../../shared/main-view"

export type EarlierState =
  | { readonly kind: "none" }
  | { readonly kind: "more"; readonly cursor: MainTimelineCursor }
  | { readonly kind: "loading"; readonly cursor: MainTimelineCursor }
  | { readonly kind: "failed"; readonly cursor: MainTimelineCursor; readonly message: string }

export type TimelineState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready"
      readonly mainSessionId: string
      readonly items: readonly MainTimelineItem[]
      readonly earlier: EarlierState
      readonly replying: boolean
      readonly reconnecting: boolean
    }
  | { readonly status: "failed"; readonly message: string }

export type ReadyTimeline = Extract<TimelineState, { readonly status: "ready" }>

export const LOADING_TIMELINE: TimelineState = { status: "loading" }

const earlierOf = (cursor: MainTimelineCursor | undefined): EarlierState =>
  cursor === undefined ? { kind: "none" } : { kind: "more", cursor }

const sameCursor = (a: MainTimelineCursor, b: MainTimelineCursor) =>
  a.sessionId === b.sessionId && a.seq === b.seq

export function applyFrame(state: TimelineState, frame: MainTimelineFrame): TimelineState {
  if (frame.kind === "start" || state.status !== "ready") {
    return {
      status: "ready",
      mainSessionId: frame.mainSessionId,
      items: frame.items,
      earlier: frame.kind === "start" ? earlierOf(frame.earlier) : { kind: "none" },
      replying: frame.replying,
      reconnecting: false,
    }
  }
  const known = new Set(state.items.map((item) => item.id))
  const added = frame.items.filter((item) => !known.has(item.id))
  return {
    ...state,
    mainSessionId: frame.mainSessionId,
    items: added.length === 0 ? state.items : [...state.items, ...added],
    replying: frame.replying,
    reconnecting: false,
  }
}

export function streamLost(state: TimelineState, message: string | undefined): TimelineState {
  if (state.status === "ready") return { ...state, reconnecting: true, replying: false }
  return message === undefined ? state : { status: "failed", message }
}

export function earlierCursor(state: TimelineState): MainTimelineCursor | undefined {
  if (state.status !== "ready") return undefined
  const { earlier } = state
  return earlier.kind === "more" || earlier.kind === "failed" ? earlier.cursor : undefined
}

export function pageLoading(state: TimelineState, cursor: MainTimelineCursor): TimelineState {
  if (state.status !== "ready" || earlierCursor(state) === undefined) return state
  return { ...state, earlier: { kind: "loading", cursor } }
}

export function pageLoaded(
  state: TimelineState,
  cursor: MainTimelineCursor,
  page: MainTimelinePage,
): TimelineState {
  if (state.status !== "ready" || state.earlier.kind !== "loading") return state
  if (!sameCursor(state.earlier.cursor, cursor)) return state
  const known = new Set(state.items.map((item) => item.id))
  return {
    ...state,
    items: [...page.items.filter((item) => !known.has(item.id)), ...state.items],
    earlier: earlierOf(page.earlier),
  }
}

export function pageFailed(
  state: TimelineState,
  cursor: MainTimelineCursor,
  message: string,
): TimelineState {
  if (state.status !== "ready" || state.earlier.kind !== "loading") return state
  if (!sameCursor(state.earlier.cursor, cursor)) return state
  return { ...state, earlier: { kind: "failed", cursor, message } }
}
