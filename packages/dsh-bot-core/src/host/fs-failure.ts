import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import type { BotFileErrorCode } from "../shared/files"

export type FsFailure =
  | "not-found"
  | "not-text"
  | "not-directory"
  | "not-regular-file"
  | "permission-denied"
  | "too-large"
  | "aborted"
  | "unidentified"

/** dsh-fs `FS_ERROR_CODES`, and the Node errno codes dsh-fs' `fsErrorFromErrno` classifies. */
export const FS_FAILURE_BY_CODE = {
  FS_NOT_FOUND: "not-found",
  FS_NOT_TEXT: "not-text",
  FS_NOT_DIRECTORY: "not-directory",
  FS_NOT_REGULAR_FILE: "not-regular-file",
  FS_PERMISSION_DENIED: "permission-denied",
  FS_SANDBOX_DENIED: "permission-denied",
  FS_TOO_LARGE: "too-large",
  FS_ABORTED: "aborted",
  ENOENT: "not-found",
  ENOTDIR: "not-found",
  EACCES: "permission-denied",
  EPERM: "permission-denied",
  EISDIR: "not-regular-file",
} as const satisfies Readonly<Record<string, Exclude<FsFailure, "unidentified">>>

export type FsFailureCode = keyof typeof FS_FAILURE_BY_CODE

/** The `name` dsh-ssh gives the helper's error on the client side. */
export const REMOTE_OPERATION_ERROR = "RemoteOperationError"

interface CodedError {
  readonly name?: unknown
  readonly code?: unknown
  readonly cause?: unknown
}

const asCoded = (value: unknown): CodedError | undefined =>
  typeof value === "object" && value !== null ? (value as CodedError) : undefined

const failureOfCode = (code: unknown): FsFailure | undefined =>
  typeof code === "string" && Object.hasOwn(FS_FAILURE_BY_CODE, code)
    ? FS_FAILURE_BY_CODE[code as FsFailureCode]
    : undefined

// dsh-fs-ssh adopts the helper's code only when its `instanceof` recognises dsh-ssh's class;
// with dsh-ssh loaded twice it says FS_IO_ERROR and the code survives on the named cause.
const remoteCodeOf = (error: CodedError): unknown => {
  const cause = asCoded(error.cause)
  return cause?.name === REMOTE_OPERATION_ERROR ? cause.code : undefined
}

/** The failure `error` names by its structured code (never its message). */
export function fsFailureOf(error: unknown): FsFailure {
  const coded = asCoded(error)
  if (coded === undefined) return "unidentified"
  return failureOfCode(coded.code) ?? failureOfCode(remoteCodeOf(coded)) ?? "unidentified"
}

/** What a failed `botFiles` call read: a path, under the byte cap the call enforces if it has one. */
export type FsFailureSubject =
  | { readonly kind: "uncapped"; readonly path: string }
  | { readonly kind: "capped"; readonly path: string; readonly limit: number }

export interface FsFailureContext {
  readonly sessionId: string
  readonly subject: FsFailureSubject
  /** The quoted path and the environment's own message. */
  readonly description: string
  readonly cause: unknown
}

type Translation = (context: FsFailureContext) => RemoteError<BotFileErrorCode>

const options = (context: FsFailureContext) => ({ cause: context.cause })

const unavailable = (context: FsFailureContext, reason: string) =>
  new RemoteError(
    "bot-file/unavailable",
    `the bot's environment could not answer for ${context.description}${reason}`,
    { sessionId: context.sessionId },
    options(context),
  )

/** Every environment failure as the `bot-file/…` error it answers; the caller's own abort never reaches it. */
export const BOT_FILE_ERROR_OF_FAILURE = {
  "not-found": (c) =>
    new RemoteError("bot-file/not-found", c.description, { path: c.subject.path }, options(c)),
  "not-text": (c) =>
    new RemoteError("bot-file/not-text", c.description, { path: c.subject.path }, options(c)),
  "not-directory": (c) =>
    new RemoteError(
      "bot-file/not-directory",
      c.description,
      { path: c.subject.path, kind: "other" },
      options(c),
    ),
  "not-regular-file": (c) =>
    new RemoteError(
      "bot-file/not-regular-file",
      c.description,
      { path: c.subject.path, kind: "other" },
      options(c),
    ),
  "permission-denied": (c) =>
    new RemoteError(
      "bot-file/permission-denied",
      c.description,
      { path: c.subject.path },
      options(c),
    ),
  "too-large": (c) =>
    c.subject.kind === "capped"
      ? new RemoteError(
          "bot-file/too-large",
          c.description,
          { path: c.subject.path, limit: c.subject.limit },
          options(c),
        )
      : unavailable(c, " (it reported a size cap this call does not enforce)"),
  aborted: (c) => unavailable(c, " (it aborted the call)"),
  unidentified: (c) => unavailable(c, ""),
} as const satisfies { readonly [F in FsFailure]: Translation }

export const botFileErrorOf = (
  failure: FsFailure,
  context: FsFailureContext,
): RemoteError<BotFileErrorCode> => BOT_FILE_ERROR_OF_FAILURE[failure](context)
