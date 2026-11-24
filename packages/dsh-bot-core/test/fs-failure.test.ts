import { describe, expect, expectTypeOf, it } from "vitest"
import {
  BOT_FILE_ERROR_OF_FAILURE,
  botFileErrorOf,
  FS_FAILURE_BY_CODE,
  type FsFailure,
  type FsFailureCode,
  type FsFailureContext,
  fsFailureOf,
} from "../src/host/fs-failure"
import { localFsError, sshFsError, sshTransportError } from "./support/fs-errors"

const CODES = Object.keys(FS_FAILURE_BY_CODE) as FsFailureCode[]

describe("fsFailureOf", () => {
  it.each(CODES)("classifies %s from a local provider and over SSH, adopted or not", (code) => {
    const expected = FS_FAILURE_BY_CODE[code]
    expect(fsFailureOf(localFsError(code))).toBe(expected)
    expect(fsFailureOf(sshFsError(code, { adopted: true }))).toBe(expected)
    expect(fsFailureOf(sshFsError(code, { adopted: false }))).toBe(expected)
  })

  it("classifies a Node errno as dsh-fs' fsErrorFromErrno does", () => {
    const errno = (code: string) => Object.assign(new Error(code), { code })
    expect(fsFailureOf(errno("ENOENT"))).toBe("not-found")
    expect(fsFailureOf(errno("ENOTDIR"))).toBe("not-found")
    expect(fsFailureOf(errno("EACCES"))).toBe("permission-denied")
    expect(fsFailureOf(errno("EPERM"))).toBe("permission-denied")
    expect(fsFailureOf(errno("EISDIR"))).toBe("not-regular-file")
  })

  it("names a failure unidentified when the environment could not answer", () => {
    expect(fsFailureOf(sshTransportError("cannot reach the bot VM over SSH (x): timeout"))).toBe(
      "unidentified",
    )
    expect(fsFailureOf(localFsError("FS_IO_ERROR"))).toBe("unidentified")
    expect(fsFailureOf(sshFsError("FS_IO_ERROR", { adopted: true }))).toBe("unidentified")
    expect(fsFailureOf(sshFsError("SUBPROCESS_EXECUTABLE_NOT_FOUND", { adopted: false }))).toBe(
      "unidentified",
    )
    expect(fsFailureOf(new Error("boom"))).toBe("unidentified")
    expect(fsFailureOf("boom")).toBe("unidentified")
    expect(fsFailureOf(undefined)).toBe("unidentified")
  })

  it("reads a cause's code only from dsh-ssh's RemoteOperationError, never from its message", () => {
    const wrapped = (cause: unknown) =>
      Object.assign(new Error("x"), { name: "FsError", code: "FS_IO_ERROR", cause })
    expect(fsFailureOf(wrapped(Object.assign(new Error("x"), { code: "ENOENT" })))).toBe(
      "unidentified",
    )
    expect(
      fsFailureOf(sshFsError("FS_IO_ERROR", { adopted: false, message: "binary file not found" })),
    ).toBe("unidentified")
  })
})

describe("botFileErrorOf", () => {
  const cause = new Error("helper said no")
  const capped: FsFailureContext = {
    sessionId: "s",
    subject: { kind: "capped", path: "a.txt", limit: 64 },
    description: '"a.txt": helper said no',
    cause,
  }
  const uncapped: FsFailureContext = { ...capped, subject: { kind: "uncapped", path: "a.txt" } }
  const answer = (failure: FsFailure, context: FsFailureContext) => {
    const error = botFileErrorOf(failure, context)
    return { code: error.code, details: error.details, cause: error.cause }
  }

  it("translates every failure, total over FsFailure", () => {
    expectTypeOf<keyof typeof BOT_FILE_ERROR_OF_FAILURE>().toEqualTypeOf<FsFailure>()
    const table: readonly [FsFailure, string, object][] = [
      ["not-found", "bot-file/not-found", { path: "a.txt" }],
      ["not-text", "bot-file/not-text", { path: "a.txt" }],
      ["not-directory", "bot-file/not-directory", { path: "a.txt", kind: "other" }],
      ["not-regular-file", "bot-file/not-regular-file", { path: "a.txt", kind: "other" }],
      ["permission-denied", "bot-file/permission-denied", { path: "a.txt" }],
      ["too-large", "bot-file/too-large", { path: "a.txt", limit: 64 }],
      ["aborted", "bot-file/unavailable", { sessionId: "s" }],
      ["unidentified", "bot-file/unavailable", { sessionId: "s" }],
    ]
    expect(table.map(([failure]) => failure).sort()).toEqual(
      Object.keys(BOT_FILE_ERROR_OF_FAILURE).sort(),
    )
    for (const [failure, code, details] of table) {
      expect(answer(failure, capped)).toEqual({ code, details, cause })
    }
  })

  it("answers too-large of a call without a byte cap as unavailable, saying why", () => {
    expect(answer("too-large", uncapped)).toEqual({
      code: "bot-file/unavailable",
      details: { sessionId: "s" },
      cause,
    })
    expect(botFileErrorOf("too-large", uncapped).message).toBe(
      'the bot\'s environment could not answer for "a.txt": helper said no (it reported a size cap this call does not enforce)',
    )
    expect(botFileErrorOf("unidentified", uncapped).message).toBe(
      'the bot\'s environment could not answer for "a.txt": helper said no',
    )
  })
})
