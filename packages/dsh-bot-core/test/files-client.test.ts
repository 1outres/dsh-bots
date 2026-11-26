import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest"
import { BotFileError } from "../src/client/file-failure"
import { createBotFilesClient } from "../src/client/files"
import type {
  BotChannelsRemote,
  BotFilesRemote,
  BotsRemote,
  RemoteMount,
} from "../src/client/remote"

const mounted = (botFiles: Partial<BotFilesRemote>): Promise<RemoteMount> =>
  Promise.resolve({
    status: "mounted",
    remote: {
      bots: {} as BotsRemote,
      botFiles: botFiles as BotFilesRemote,
      botChannels: {} as BotChannelsRemote,
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
      botSettings: {} as never,
      botNotes: {} as never,
      botEnvironment: {} as never,
      botEnvironmentHost: {} as never,
      botOnboarding: {} as never,
      botVaults: {} as never,
      botSenders: {} as never,
      botGroups: {} as never,
    },
  })

const failureOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  )
  expect(error).toBeInstanceOf(BotFileError)
  return (error as BotFileError).failure
}

describe("createBotFilesClient", () => {
  let consoleError: MockInstance<typeof console.error>
  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("unwraps a result and passes the arguments through", async () => {
    const stat = vi.fn(async () => ({
      ok: true as const,
      value: { absolutePath: "/a", version: "1" },
    }))
    const files = createBotFilesClient(mounted({ stat }))
    const signal = new AbortController().signal
    await expect(files.stat("b1", "a", signal)).resolves.toEqual({
      absolutePath: "/a",
      version: "1",
    })
    expect(stat).toHaveBeenCalledWith("b1", "a", signal)
  })

  it("reports a refusal with a known code as the Host's, the Gateway's bad request included", async () => {
    const files = createBotFilesClient(
      mounted({
        read: async () => ({ ok: false, error: { code: "bot-file/not-text", message: "binary" } }),
        list: async () => ({ ok: false, error: { code: "gateway/bad-request", message: "path" } }),
      }),
    )
    expect(await failureOf(files.read("b1", "a"))).toEqual({
      kind: "host",
      code: "bot-file/not-text",
      message: "binary",
    })
    expect(await failureOf(files.list("b1", "a"))).toMatchObject({
      kind: "host",
      code: "gateway/bad-request",
    })
  })

  it("reports a thrown call as a connection failure, and rethrows an abort as is", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" })
    const files = createBotFilesClient(
      mounted({
        readBytes: async () => {
          throw new Error("socket closed")
        },
        search: async () => {
          throw abort
        },
      }),
    )
    expect(await failureOf(files.readBytes("b1", "a"))).toEqual({
      kind: "connection",
      message: "socket closed",
    })
    await expect(files.search("b1", { query: "x" })).rejects.toBe(abort)
  })

  it("reports a failed mount without calling the Host", async () => {
    const files = createBotFilesClient(Promise.resolve({ status: "failed", error: "no remote" }))
    expect(await failureOf(files.list("b1", ""))).toEqual({ kind: "mount", message: "no remote" })
  })

  it("reports an unknown or missing code and a malformed result as a protocol failure", async () => {
    const unknown = { ok: false as const, error: { code: "bot-file/new", message: "later" } }
    const noCode = { ok: false as const, error: { message: "no code" } }
    const noError = { ok: false }
    const files = createBotFilesClient(
      mounted({
        stat: async () => unknown,
        read: async () => noCode,
        search: vi.fn(async () => noError) as unknown as BotFilesRemote["search"],
        list: vi.fn(async () => "garbage") as unknown as BotFilesRemote["list"],
      }),
    )
    expect(await failureOf(files.stat("b1", "a"))).toEqual({
      kind: "protocol",
      violation: { kind: "unknown-code" },
      message: "unknown failure code bot-file/new: later",
      raw: unknown,
    })
    expect(await failureOf(files.read("b1", "a"))).toEqual({
      kind: "protocol",
      violation: { kind: "unknown-code" },
      message: "unknown failure code undefined: no code",
      raw: noCode,
    })
    expect(await failureOf(files.search("b1", { query: "x" }))).toEqual({
      kind: "protocol",
      violation: { kind: "malformed-refusal" },
      message: "a refusal without an error",
      raw: noError,
    })
    expect(await failureOf(files.list("b1", ""))).toEqual({
      kind: "protocol",
      violation: { kind: "malformed-result" },
      message: "a malformed result",
      raw: "garbage",
    })
  })

  it("reports the Gateway's refusal of the call's arguments as a contract violation", async () => {
    const response = {
      ok: false as const,
      error: {
        code: "gateway/arguments-invalid",
        message:
          'botFiles/readBytes: args fields do not match the descriptor: unexpected "options"',
      },
    }
    const files = createBotFilesClient(mounted({ readBytes: async () => response }))
    expect(await failureOf(files.readBytes("b1", "a.png", {}))).toEqual({
      kind: "protocol",
      violation: { kind: "contract", code: "gateway/arguments-invalid" },
      message: response.error.message,
      raw: response,
    })
  })

  it("logs each protocol failure once with the raw response, and no other failure", async () => {
    const response = { ok: false as const, error: { code: "gateway/input-invalid", message: "x" } }
    const files = createBotFilesClient(
      mounted({
        stat: async () => response,
        read: async () => ({ ok: false, error: { code: "bot-file/not-text", message: "binary" } }),
        list: async () => {
          throw new Error("socket closed")
        },
      }),
    )
    await failureOf(files.stat("b1", "a"))
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("(contract): x"), response)
    await failureOf(files.read("b1", "a"))
    await failureOf(files.list("b1", ""))
    expect(consoleError).toHaveBeenCalledTimes(1)
  })
})
