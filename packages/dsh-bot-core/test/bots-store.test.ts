import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { BotsRemote, RemoteMount } from "../src/client/remote"
import type { BotsState } from "../src/client/session-classification"
import { watchBots } from "../src/client/store"
import type { BotsSnapshot } from "../src/shared/bots"
import { bot, creating, value } from "./support/client"

/** One `watch` stream per call, fed and ended by the test. */
function remote() {
  const streams: {
    push(snapshot: BotsSnapshot): void
    fail(error: Error): void
    disposed: boolean
  }[] = []
  const watch = vi.fn(() => {
    const queue: (BotsSnapshot | Error)[] = []
    let wake: (() => void) | undefined
    const stream = {
      disposed: false,
      push(snapshot: BotsSnapshot) {
        queue.push(snapshot)
        wake?.()
      },
      fail(error: Error) {
        queue.push(error)
        wake?.()
      },
    }
    streams.push(stream)
    return {
      async *[Symbol.asyncIterator]() {
        while (!stream.disposed) {
          const next = queue.shift()
          if (next instanceof Error) throw next
          if (next !== undefined) {
            yield next
            continue
          }
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      },
      dispose() {
        stream.disposed = true
        wake?.()
      },
    }
  })
  const bots = { watch } as unknown as BotsRemote
  const mount: RemoteMount = {
    status: "mounted",
    remote: {
      bots,
      botFiles: {} as never,
      botChannels: {} as never,
      botInteractions: {} as never,
      botConnectors: {} as never,
      botConnectorActions: {} as never,
      botConnections: {} as never,
      botConnectorStreams: {} as never,
      botWeb: {} as never,
      botManagedSessions: {} as never,
      botWorkspaces: {} as never,
      botMains: {} as never,
      botSkills: {} as never,
      botNotes: {} as never,
      botEnvironment: {} as never,
      botEnvironmentHost: {} as never,
      botOnboarding: {} as never,
      botVaults: {} as never,
    },
  }
  return { mount, watch, streams, bots }
}

const listed: BotsSnapshot = {
  bots: [bot("x", "m1", ["s1"])],
  pending: [creating("c", ["c1"])],
  preparingSessionIds: [],
}

describe("watchBots", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(console, "warn").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("is loading, then ready with each delivered list", async () => {
    const fake = remote()
    const store = watchBots(Promise.resolve(fake.mount), value<object | undefined>({}))
    expect(store.getSnapshot()).toEqual({ status: "loading" })
    await vi.advanceTimersByTimeAsync(0)
    expect(store.remote()).toBe(fake.bots)
    fake.streams[0]?.push(listed)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ status: "ready", snapshot: listed })
    store.dispose()
  })

  it("is unavailable when no list ever arrived, and retries with backoff", async () => {
    const fake = remote()
    const store = watchBots(Promise.resolve(fake.mount), value<object | undefined>({}))
    await vi.advanceTimersByTimeAsync(0)
    fake.streams[0]?.fail(new Error("closed"))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ status: "unavailable", error: "watch: closed" })
    expect(console.warn).toHaveBeenCalledWith("bot-core: watch: closed")
    await vi.advanceTimersByTimeAsync(1000)
    expect(fake.watch).toHaveBeenCalledTimes(2)
    fake.streams[1]?.push(listed)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ status: "ready", snapshot: listed })
    store.dispose()
  })

  it("keeps the last list while reconnecting, and is ready again with the next one", async () => {
    const fake = remote()
    const store = watchBots(Promise.resolve(fake.mount), value<object | undefined>({}))
    const seen: BotsState[] = []
    store.subscribe(() => seen.push(store.getSnapshot()))
    await vi.advanceTimersByTimeAsync(0)
    fake.streams[0]?.push(listed)
    await vi.advanceTimersByTimeAsync(0)
    fake.streams[0]?.fail(new Error("socket closed"))
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ status: "reconnecting", snapshot: listed })
    await vi.advanceTimersByTimeAsync(1000)
    const next = { bots: [], pending: [], preparingSessionIds: [] }
    fake.streams[1]?.push(next)
    await vi.advanceTimersByTimeAsync(0)
    expect(seen.map((state) => state.status)).toEqual(["ready", "reconnecting", "ready"])
    expect(store.getSnapshot()).toEqual({ status: "ready", snapshot: next })
    store.dispose()
  })

  it("reconnects as soon as the connection has a new generation, not after the backoff", async () => {
    const fake = remote()
    const generation = value<object | undefined>({})
    const store = watchBots(Promise.resolve(fake.mount), generation)
    await vi.advanceTimersByTimeAsync(0)
    fake.streams[0]?.push(listed)
    await vi.advanceTimersByTimeAsync(0)
    generation.set(undefined)
    fake.streams[0]?.fail(new Error("socket closed"))
    await vi.advanceTimersByTimeAsync(500)
    expect(store.getSnapshot()).toEqual({ status: "reconnecting", snapshot: listed })
    expect(fake.watch).toHaveBeenCalledTimes(1)
    generation.set({})
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.watch).toHaveBeenCalledTimes(2)
    fake.streams[1]?.push(listed)
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ status: "ready", snapshot: listed })
    store.dispose()
  })

  it("retries at once when the generation changed before the failure was noticed, and keeps backoff on the same one", async () => {
    const fake = remote()
    const generation = value<object | undefined>({})
    const store = watchBots(Promise.resolve(fake.mount), generation)
    await vi.advanceTimersByTimeAsync(0)
    generation.set({})
    fake.streams[0]?.fail(new Error("socket closed"))
    await vi.advanceTimersByTimeAsync(0)
    expect(fake.watch).toHaveBeenCalledTimes(2)
    fake.streams[1]?.fail(new Error("refused"))
    await vi.advanceTimersByTimeAsync(1999)
    expect(fake.watch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fake.watch).toHaveBeenCalledTimes(3)
    store.dispose()
  })

  it("is failed for good when the Remote could not be mounted", async () => {
    const store = watchBots(
      Promise.resolve({ status: "failed", error: "no typert" }),
      value<object | undefined>({}),
    )
    await vi.advanceTimersByTimeAsync(0)
    expect(store.getSnapshot()).toEqual({ status: "failed", error: "no typert" })
    expect(store.remote()).toBeUndefined()
  })

  it("closes the stream and stops reconnecting when disposed", async () => {
    const fake = remote()
    const store = watchBots(Promise.resolve(fake.mount), value<object | undefined>({}))
    await vi.advanceTimersByTimeAsync(0)
    store.dispose()
    expect(fake.streams[0]?.disposed).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fake.watch).toHaveBeenCalledTimes(1)
  })
})
