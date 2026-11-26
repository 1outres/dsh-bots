/**
 * What the `botMainView` Remote serves (docs/specs/bot-main-view.md §3): each
 * bot's timeline over its Mains. The Main being watched is followed live from
 * its log events; former Mains are read from their stored logs, up to the
 * moment a new Main took their place.
 */
import {
  MAIN_TIMELINE_PAGE,
  type MainTimelineCursor,
  type MainTimelineFrame,
  type MainTimelineImageData,
  type MainTimelineItem,
  type MainTimelinePage,
} from "../../shared/main-view"
import type { LoggedEvent, SessionLog } from "../conversations/history"
import type { BotMainRecord } from "../registry"
import { foldEvent, replyingOf, type TimelineFold, timelineOf } from "./timeline"

/** dsh-attachment's `ImageAttachmentRef`, as `readImage` takes it. */
export interface MainImageRef {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

export interface MainViewDeps {
  /** The bot's Mains, oldest first; undefined for a bot that is not stored. */
  mainsOf(botId: string): readonly BotMainRecord[] | undefined
  /** A session's own log; undefined when DSH has no such session (yet). */
  read(sessionId: string, signal: AbortSignal): Promise<SessionLog | undefined>
  readImage(ref: MainImageRef, signal: AbortSignal): Promise<Uint8Array>
  encodeBase64(data: Uint8Array): string
  /** The bots' records changed (a bot got a new Main). */
  subscribe(listener: () => void): () => void
  /** Ends the reads of live timelines (the plugin unloads). */
  readonly signal: AbortSignal
}

export interface MainView {
  /** Every session's log events, in order. */
  sessionEvent(sessionId: string, event: LoggedEvent): void
  watch(botId: string, signal: AbortSignal): AsyncIterable<MainTimelineFrame>
  page(botId: string, before: MainTimelineCursor, signal: AbortSignal): Promise<MainTimelinePage>
  image(
    botId: string,
    sessionId: string,
    attachmentId: string,
    signal: AbortSignal,
  ): Promise<MainTimelineImageData>
}

/** The end of a session, as a cursor's position. */
const END = Number.MAX_SAFE_INTEGER

interface LiveTimeline {
  fold: TimelineFold
  items: MainTimelineItem[]
  cursor: number
  /** Events that arrived while the log was read. */
  pending: LoggedEvent[] | undefined
  readonly listeners: Set<() => void>
  readonly ready: Promise<void>
  watchers: number
}

/** Former Mains' timelines kept for paging back through them. */
const FORMER_CACHE = 4

export function createMainView(deps: MainViewDeps): MainView {
  const lives = new Map<string, LiveTimeline>()
  const former = new Map<string, readonly MainTimelineItem[]>()

  const mainsOf = (botId: string): readonly BotMainRecord[] => {
    const mains = deps.mainsOf(botId)
    if (mains === undefined) throw new Error(`bot "${botId}" does not exist`)
    return mains
  }
  const currentOf = (botId: string) => mainsOf(botId).at(-1)?.sessionId as string

  const apply = (live: LiveTimeline, event: LoggedEvent) => {
    if (event.seq <= live.cursor) return
    live.cursor = event.seq
    const folded = foldEvent(live.fold, event)
    const changed = folded.item !== undefined || replyingOf(folded.fold) !== replyingOf(live.fold)
    live.fold = folded.fold
    if (folded.item !== undefined) live.items.push(folded.item)
    if (changed) for (const listener of [...live.listeners]) listener()
  }

  const acquire = (sessionId: string): LiveTimeline => {
    const known = lives.get(sessionId)
    if (known !== undefined) {
      known.watchers += 1
      return known
    }
    const live: LiveTimeline = {
      fold: timelineOf(sessionId, { inheritedEventCount: 0, events: [] }).fold,
      items: [],
      cursor: -1,
      pending: [],
      listeners: new Set(),
      watchers: 1,
      ready: deps.read(sessionId, deps.signal).then((log) => {
        const pending = live.pending ?? []
        live.pending = undefined
        if (log !== undefined) {
          const read = timelineOf(sessionId, log)
          live.fold = read.fold
          live.items = [...read.items]
          live.cursor = read.cursor
        }
        for (const event of pending) apply(live, event)
      }),
    }
    lives.set(sessionId, live)
    live.ready.catch(() => {
      if (lives.get(sessionId) === live) lives.delete(sessionId)
    })
    return live
  }

  const release = (sessionId: string, live: LiveTimeline) => {
    live.watchers -= 1
    if (live.watchers === 0 && lives.get(sessionId) === live) lives.delete(sessionId)
  }

  const itemsOf = async (
    main: BotMainRecord,
    signal: AbortSignal,
  ): Promise<readonly MainTimelineItem[]> => {
    const live = lives.get(main.sessionId)
    if (live !== undefined && main.endedAt === undefined) {
      await live.ready
      return live.items
    }
    const cached = former.get(main.sessionId)
    if (cached !== undefined) return cached
    const log = await deps.read(main.sessionId, signal)
    const items = log === undefined ? [] : timelineOf(main.sessionId, log, main.endedAt).items
    if (main.endedAt !== undefined) {
      former.set(main.sessionId, items)
      if (former.size > FORMER_CACHE) former.delete(former.keys().next().value as string)
    }
    return items
  }

  const pageOf = async (
    mains: readonly BotMainRecord[],
    before: MainTimelineCursor,
    limit: number,
    signal: AbortSignal,
  ): Promise<MainTimelinePage> => {
    let index = mains.findIndex((main) => main.sessionId === before.sessionId)
    if (index === -1) throw new Error(`"${before.sessionId}" is not one of the bot's Mains`)
    let seq = before.seq
    let collected: readonly MainTimelineItem[] = []
    while (index >= 0) {
      const main = mains[index] as BotMainRecord
      const older = (await itemsOf(main, signal)).filter((item) => item.seq < seq)
      const room = limit - collected.length
      const taken = room <= 0 ? [] : older.slice(-room)
      collected = [...taken, ...collected]
      if (taken.length < older.length) {
        return {
          items: collected,
          earlier: { sessionId: main.sessionId, seq: (taken[0] ?? { seq }).seq },
        }
      }
      index -= 1
      seq = END
      if (collected.length >= limit) break
    }
    const previous = mains[index]
    return previous === undefined
      ? { items: collected }
      : { items: collected, earlier: { sessionId: previous.sessionId, seq: END } }
  }

  /** Wakes a stream on its live timeline's changes, the bots' records' changes and its abort. */
  const wakeups = (signal: AbortSignal) => {
    let dirty = false
    let wake: (() => void) | undefined
    const notify = () => {
      dirty = true
      wake?.()
    }
    let watched: LiveTimeline | undefined
    const offRecords = deps.subscribe(notify)
    signal.addEventListener("abort", notify)
    return {
      follow(live: LiveTimeline) {
        watched?.listeners.delete(notify)
        watched = live
        live.listeners.add(notify)
      },
      async next() {
        while (!dirty) {
          await new Promise<void>((resolve) => {
            wake = resolve
          })
          wake = undefined
        }
        dirty = false
      },
      dispose() {
        watched?.listeners.delete(notify)
        offRecords()
        signal.removeEventListener("abort", notify)
      },
    }
  }

  return {
    sessionEvent(sessionId, event) {
      const live = lives.get(sessionId)
      if (live === undefined) return
      if (live.pending !== undefined) live.pending.push(event)
      else apply(live, event)
    },

    async *watch(botId, signal) {
      let mainId = currentOf(botId)
      let live = acquire(mainId)
      const wake = wakeups(signal)
      wake.follow(live)
      try {
        await live.ready
        const tail = live.items.slice(-MAIN_TIMELINE_PAGE)
        const first = tail[0]
        const page = await pageOf(
          mainsOf(botId),
          { sessionId: mainId, seq: first === undefined ? END : first.seq },
          MAIN_TIMELINE_PAGE - tail.length,
          signal,
        )
        let sent = live.items.length
        let replying = replyingOf(live.fold)
        yield {
          kind: "start",
          mainSessionId: mainId,
          items: [...page.items, ...tail],
          ...(page.earlier === undefined ? {} : { earlier: page.earlier }),
          replying,
        }
        while (!signal.aborted) {
          await wake.next()
          if (signal.aborted) return
          const next = deps.mainsOf(botId)?.at(-1)?.sessionId
          if (next === undefined) return
          const items = live.items.slice(sent)
          const rotated = next !== mainId
          if (rotated) {
            const previous = live
            live = acquire(next)
            wake.follow(live)
            release(mainId, previous)
            mainId = next
            await live.ready
            items.push(...live.items)
          }
          sent = live.items.length
          const now = replyingOf(live.fold)
          if (items.length === 0 && now === replying && !rotated) continue
          replying = now
          yield { kind: "next", mainSessionId: mainId, items, replying }
        }
      } finally {
        wake.dispose()
        release(mainId, live)
      }
    },

    page: (botId, before, signal) => pageOf(mainsOf(botId), before, MAIN_TIMELINE_PAGE, signal),

    async image(botId, sessionId, attachmentId, signal) {
      const main = mainsOf(botId).find((known) => known.sessionId === sessionId)
      if (main === undefined) throw new Error(`"${sessionId}" is not one of the bot's Mains`)
      const image = (await itemsOf(main, signal))
        .flatMap((item) => (item.kind === "person" ? item.images : []))
        .find((known) => known.attachmentId === attachmentId)
      if (image === undefined) throw new Error("no message of the bot's Mains holds this image")
      const data = await deps.readImage(image, signal)
      return { mediaType: image.mediaType, data: deps.encodeBase64(data) }
    },
  }
}
