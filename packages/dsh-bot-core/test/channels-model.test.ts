import { describe, expect, it, vi } from "vitest"
import { ChannelsError, createChannelsModel } from "../src/client/channels-model"
import type {
  BotChannelsRemote,
  BotFilesRemote,
  BotsRemote,
  RemoteMount,
} from "../src/client/remote"
import type { BotChannelChange, BotChannelsSnapshot, BotChannelView } from "../src/shared/channels"

const view: BotChannelView = {
  channel: { id: "example", name: "Example", fields: [] },
  enabled: false,
  values: {},
  secrets: {},
  status: { state: "off" },
  revision: 0,
}

const snapshot: BotChannelsSnapshot = { botId: "a", channels: [view] }

const change: BotChannelChange = { enabled: true, values: {}, secrets: {} }

function mounted(botChannels: Partial<BotChannelsRemote>): Promise<RemoteMount> {
  return Promise.resolve({
    status: "mounted",
    remote: {
      bots: {} as BotsRemote,
      botFiles: {} as BotFilesRemote,
      botChannels: botChannels as BotChannelsRemote,
      botInteractions: {} as never,
      botConnectors: {} as never,
      botConnectorActions: {} as never,
      botConnections: {} as never,
      botConnectorStreams: {} as never,
      botWeb: {} as never,
      botManagedSessions: {} as never,
      botWorkspaces: {} as never,
      botMains: {} as never,
      botMainView: {} as never,
      botSkills: {} as never,
      botNotes: {} as never,
      botEnvironment: {} as never,
      botEnvironmentHost: {} as never,
      botOnboarding: {} as never,
      botVaults: {} as never,
    },
  })
}

function streamOf(...snapshots: BotChannelsSnapshot[]) {
  const dispose = vi.fn()
  return {
    dispose,
    handle: {
      dispose,
      async *[Symbol.asyncIterator]() {
        yield* snapshots
        await new Promise(() => {})
      },
    },
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

const rejection = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  )
  expect(error).toBeInstanceOf(ChannelsError)
  return (error as ChannelsError).failure
}

describe("createChannelsModel", () => {
  it("follows the bot's snapshots and stops on dispose", async () => {
    const stream = streamOf(snapshot)
    const watch = vi.fn(() => stream.handle)
    const model = createChannelsModel(mounted({ watch }), "a")
    expect(model.getSnapshot()).toEqual({ status: "loading" })
    await settle()
    expect(watch).toHaveBeenCalledWith("a")
    expect(model.getSnapshot()).toEqual({ status: "ready", snapshot })
    model.dispose()
    expect(stream.dispose).toHaveBeenCalled()
  })

  it("reports a failed mount as final", async () => {
    const model = createChannelsModel(Promise.resolve({ status: "failed", error: "no" }), "a")
    await settle()
    expect(model.getSnapshot()).toEqual({
      status: "failed",
      failure: { kind: "mount", message: "no" },
    })
    expect(await rejection(model.configure("example", change))).toEqual({
      kind: "mount",
      message: "no",
    })
  })

  it("reports a broken stream as a connection failure", async () => {
    const watch = vi.fn(() => ({
      dispose() {},
      // biome-ignore lint/correctness/useYield: -
      async *[Symbol.asyncIterator](): AsyncGenerator<BotChannelsSnapshot> {
        throw new Error("gone")
      },
    }))
    const model = createChannelsModel(mounted({ watch }), "a")
    await settle()
    expect(model.getSnapshot()).toEqual({
      status: "failed",
      failure: { kind: "connection", message: "gone" },
    })
  })

  it("unwraps a save and types its refusals", async () => {
    const configure = vi
      .fn<BotChannelsRemote["configure"]>()
      .mockResolvedValueOnce({ ok: true, value: { saved: true, view } })
      .mockResolvedValueOnce({ ok: false, error: { code: "x", message: "invalid" } })
      .mockResolvedValueOnce({ ok: false, error: {} })
      .mockRejectedValueOnce(new Error("offline"))
    const model = createChannelsModel(mounted({ watch: () => streamOf().handle, configure }), "a")
    await expect(model.configure("example", change)).resolves.toBe(view)
    expect(configure).toHaveBeenCalledWith("a", "example", change)
    expect(await rejection(model.configure("example", change))).toEqual({
      kind: "refused",
      message: "invalid",
    })
    expect((await rejection(model.configure("example", change))).kind).toBe("protocol")
    expect(await rejection(model.configure("example", change))).toEqual({
      kind: "connection",
      message: "offline",
    })
    model.dispose()
  })
})
