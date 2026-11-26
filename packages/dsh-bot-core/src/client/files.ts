import { BOT_FILE_WIRE_CODES, type BotFileWireCode } from "../shared/files"
import type { BotFilesApi } from "../shared/files-api"
import { REMOTE_CONTRACT_CODES, type RemoteContractCode } from "../shared/remote-contract"
import {
  BotFileError,
  type BotFileFailure,
  protocolFailure,
  reportProtocolFailure,
} from "./file-failure"
import type { BotFilesRemote, RemoteMount } from "./remote"

export type BotFilesClient = BotFilesApi

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isAbort = (error: unknown) => error instanceof Error && error.name === "AbortError"

const codeIn =
  <Code extends string>(codes: readonly Code[]) =>
  (code: unknown): code is Code =>
    typeof code === "string" && (codes as readonly string[]).includes(code)

const isWireCode = codeIn<BotFileWireCode>(BOT_FILE_WIRE_CODES)

const isContractCode = codeIn<RemoteContractCode>(REMOTE_CONTRACT_CODES)

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null

function refusalOf(result: Readonly<Record<string, unknown>>): BotFileFailure {
  const { error } = result
  if (!isRecord(error)) {
    return protocolFailure({ kind: "malformed-refusal" }, "a refusal without an error", result)
  }
  const { code, message } = error
  if (typeof message !== "string") {
    return protocolFailure({ kind: "malformed-refusal" }, "a refusal without a message", result)
  }
  if (isContractCode(code)) return protocolFailure({ kind: "contract", code }, message, result)
  if (!isWireCode(code)) {
    return protocolFailure(
      { kind: "unknown-code" },
      `unknown failure code ${String(code)}: ${message}`,
      result,
    )
  }
  return { kind: "host", code, message }
}

function failed(failure: BotFileFailure): BotFileError {
  if (failure.kind === "protocol") reportProtocolFailure(failure)
  return new BotFileError(failure)
}

function unwrap<T>(result: unknown): T {
  if (!isRecord(result) || typeof result.ok !== "boolean") {
    throw failed(protocolFailure({ kind: "malformed-result" }, "a malformed result", result))
  }
  if (result.ok) return result.value as T
  throw failed(refusalOf(result))
}

export function createBotFilesClient(mount: Promise<RemoteMount>): BotFilesClient {
  const call = async <T>(run: (files: BotFilesRemote) => Promise<unknown>): Promise<T> => {
    const mounted = await mount
    if (mounted.status === "failed") {
      throw failed({ kind: "mount", message: mounted.error })
    }
    let result: unknown
    try {
      result = await run(mounted.remote.botFiles)
    } catch (error) {
      if (isAbort(error)) throw error
      throw failed({ kind: "connection", message: messageOf(error) })
    }
    return unwrap<T>(result)
  }
  return {
    stat: (sessionId, path, signal) => call((files) => files.stat(sessionId, path, signal)),
    read: (sessionId, path, range, signal) =>
      call((files) => files.read(sessionId, path, range, signal)),
    readBytes: (sessionId, path, options, signal) =>
      call((files) => files.readBytes(sessionId, path, options, signal)),
    list: (sessionId, path, signal) => call((files) => files.list(sessionId, path, signal)),
    search: (sessionId, request, signal) =>
      call((files) => files.search(sessionId, request, signal)),
  }
}
