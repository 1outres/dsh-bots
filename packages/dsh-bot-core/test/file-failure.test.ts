import { afterEach, describe, expect, it, vi } from "vitest"
import {
  BotFileError,
  type BotFileFailure,
  failureKey,
  protocolFailure,
  reportProtocolFailure,
} from "../src/client/file-failure"
import { en, ja } from "../src/client/i18n"
import { BOT_FILE_WIRE_CODES } from "../src/shared/files"

const failures: readonly BotFileFailure[] = [
  ...BOT_FILE_WIRE_CODES.map((code): BotFileFailure => ({ kind: "host", code, message: code })),
  { kind: "connection", message: "socket closed" },
  { kind: "mount", message: "no typert" },
  protocolFailure({ kind: "unknown-code" }, "unknown code", { code: "bot-file/new" }),
]

afterEach(() => {
  vi.restoreAllMocks()
})

describe("failureKey", () => {
  it("words every wire code and every failure kind with its own translated message", () => {
    const keys = failures.map(failureKey)
    expect(new Set(keys).size).toBe(failures.length)
    for (const key of keys) {
      expect(en[key]).toBeDefined()
      expect(ja[key]).toBeDefined()
    }
  })

  it("words the Host's codes by their suffix and the client's failures apart from unavailable", () => {
    expect(failureKey({ kind: "host", code: "bot-file/not-found", message: "" })).toBe(
      "files.error.not-found",
    )
    expect(failureKey({ kind: "host", code: "gateway/bad-request", message: "" })).toBe(
      "files.error.bad-request",
    )
    expect(failureKey({ kind: "connection", message: "" })).toBe("files.error.connection")
    expect(failureKey({ kind: "mount", message: "" })).toBe("files.error.remote-mount-failed")
    expect(
      failureKey(
        protocolFailure({ kind: "contract", code: "gateway/arguments-invalid" }, "", undefined),
      ),
    ).toBe("files.error.protocol")
  })
})

describe("reportProtocolFailure", () => {
  it("logs the violation, its message and the raw response to the console", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const raw = { ok: false, error: { code: "gateway/arguments-invalid", message: "unexpected" } }
    reportProtocolFailure(
      protocolFailure({ kind: "contract", code: "gateway/arguments-invalid" }, "unexpected", raw),
    )
    expect(error).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledWith(expect.stringContaining("(contract): unexpected"), raw)
  })
})

describe("BotFileError", () => {
  it("carries its failure and its message", () => {
    const failure: BotFileFailure = { kind: "connection", message: "socket closed" }
    const error = new BotFileError(failure)
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe("BotFileError")
    expect(error.message).toBe("socket closed")
    expect(error.failure).toBe(failure)
  })
})
