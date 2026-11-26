import { SPACE_LIMITS, type SpaceLiveEvent, type SpaceViewer } from "../../shared/spaces"

export interface LiveSink {
  send(event: string, data: unknown): void
  comment(): void
  close(): void
}

export type LiveChannel = "page" | "wrapper"

export interface LiveSubscriber {
  readonly spaceId: string
  readonly botId: string
  readonly viewer: SpaceViewer
  readonly access: string
  readonly channel: LiveChannel
  readonly sink: LiveSink
}

export interface SpaceLive {
  open(subscriber: LiveSubscriber): (() => void) | undefined
  publish(spaceId: string, event: SpaceLiveEvent): number
  close(matches: (subscriber: LiveSubscriber) => boolean): number
  count(spaceId: string): number
  subscribe(listener: (spaceId: string) => void): () => void
  dispose(): void
}

const WRAPPER_EVENTS: ReadonlySet<SpaceLiveEvent["event"]> = new Set(["revision", "gone"])

export function createSpaceLive(deps: {
  later(ms: number, work: () => void): () => void
  valid(subscriber: LiveSubscriber): boolean
}): SpaceLive {
  const subscribers = new Set<LiveSubscriber>()
  const listeners = new Set<(spaceId: string) => void>()
  let heartbeat: (() => void) | undefined
  const changed = (spaceId: string) => {
    for (const listener of [...listeners]) listener(spaceId)
  }
  const count = (spaceId: string) =>
    [...subscribers].filter((subscriber) => subscriber.spaceId === spaceId).length
  const beat = () => {
    heartbeat = undefined
    if (subscribers.size === 0) return
    for (const subscriber of [...subscribers]) {
      if (deps.valid(subscriber)) {
        subscriber.sink.comment()
        continue
      }
      subscriber.sink.send("gone", {})
      subscriber.sink.close()
      drop(subscriber)
    }
    if (subscribers.size === 0) return
    heartbeat = deps.later(SPACE_LIMITS.liveKeepAliveMs, beat)
  }
  const drop = (subscriber: LiveSubscriber) => {
    if (!subscribers.delete(subscriber)) return
    changed(subscriber.spaceId)
    if (subscribers.size === 0) {
      heartbeat?.()
      heartbeat = undefined
    }
  }
  return {
    open(subscriber) {
      if (count(subscriber.spaceId) >= SPACE_LIMITS.liveStreams) return undefined
      subscribers.add(subscriber)
      if (heartbeat === undefined) heartbeat = deps.later(SPACE_LIMITS.liveKeepAliveMs, beat)
      changed(subscriber.spaceId)
      return () => drop(subscriber)
    },
    publish(spaceId, event) {
      let reached = 0
      for (const subscriber of [...subscribers]) {
        if (subscriber.spaceId !== spaceId) continue
        if (subscriber.channel === "wrapper" && !WRAPPER_EVENTS.has(event.event)) continue
        subscriber.sink.send(event.event, event.data)
        reached += 1
      }
      return reached
    },
    close(matches) {
      let closed = 0
      for (const subscriber of [...subscribers]) {
        if (!matches(subscriber)) continue
        subscriber.sink.send("gone", {})
        subscriber.sink.close()
        drop(subscriber)
        closed += 1
      }
      return closed
    },
    count,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      for (const subscriber of [...subscribers]) {
        subscriber.sink.close()
        subscribers.delete(subscriber)
      }
      heartbeat?.()
      heartbeat = undefined
      listeners.clear()
    },
  }
}
