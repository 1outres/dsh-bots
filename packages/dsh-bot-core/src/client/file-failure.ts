import type { BotFileWireCode } from "../shared/files"
import type { RemoteContractCode } from "../shared/remote-contract"
import type { MessageKey } from "./i18n"

export type ProtocolViolation =
  | { readonly kind: "contract"; readonly code: RemoteContractCode }
  | { readonly kind: "unknown-code" }
  | { readonly kind: "malformed-refusal" }
  | { readonly kind: "malformed-result" }
  | { readonly kind: "foreign-rejection" }

export interface ProtocolFailure {
  readonly kind: "protocol"
  readonly violation: ProtocolViolation
  readonly message: string
  readonly raw: unknown
}

export type BotFileFailure =
  | { readonly kind: "host"; readonly code: BotFileWireCode; readonly message: string }
  | { readonly kind: "connection"; readonly message: string }
  | { readonly kind: "mount"; readonly message: string }
  | ProtocolFailure

export class BotFileError extends Error {
  override readonly name = "BotFileError"
  constructor(readonly failure: BotFileFailure) {
    super(failure.message)
  }
}

export const protocolFailure = (
  violation: ProtocolViolation,
  message: string,
  raw: unknown,
): ProtocolFailure => ({ kind: "protocol", violation, message, raw })

export function reportProtocolFailure(failure: ProtocolFailure): void {
  console.error(
    `bot-core: botFiles answered outside its contract (${failure.violation.kind}): ${failure.message}`,
    failure.raw,
  )
}

const HOST_KEYS: { readonly [Code in BotFileWireCode]: MessageKey } = {
  "bot-file/not-bot-session": "files.error.not-bot-session",
  "bot-file/unavailable": "files.error.unavailable",
  "bot-file/not-found": "files.error.not-found",
  "bot-file/outside-workspace": "files.error.outside-workspace",
  "bot-file/too-large": "files.error.too-large",
  "bot-file/not-text": "files.error.not-text",
  "bot-file/not-regular-file": "files.error.not-regular-file",
  "bot-file/not-directory": "files.error.not-directory",
  "bot-file/permission-denied": "files.error.permission-denied",
  "bot-file/search-failed": "files.error.search-failed",
  "gateway/bad-request": "files.error.bad-request",
}

export function failureKey(failure: BotFileFailure): MessageKey {
  switch (failure.kind) {
    case "host":
      return HOST_KEYS[failure.code]
    case "connection":
      return "files.error.connection"
    case "mount":
      return "files.error.remote-mount-failed"
    case "protocol":
      return "files.error.protocol"
  }
}
