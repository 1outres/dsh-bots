import type {
  BotByteReadOptions,
  BotDirectoryListing,
  BotFileBytes,
  BotFileRange,
  BotFileSearchRequest,
  BotFileSearchResult,
  BotFileStat,
  BotFileText,
} from "./files"

/**
 * The `botFiles` Remote: read-only access to a bot session's files in the
 * bot's environment, never the Host's file system. It mirrors
 * `workspaceFiles` (dsh-api-workspace-files) in field names and page, window
 * and listing semantics, except that:
 * - every method names the session as a plain `sessionId`, answered only for
 *   a session bot-core recorded as a stored bot's;
 * - `readBytes` returns base64 (`base64`), since bot-core's Remotes are JSON-only;
 * - there is no `changes` feed;
 * - failures carry a `BotFileWireCode` (files.ts).
 *
 * `read`, `readBytes` and `stat` take an absolute or workspace-relative path
 * and report the absolute one; `list` and `search` speak `/`-joined
 * workspace-relative paths.
 */
export interface BotFilesApi {
  /** Identity, version and size of one regular file. */
  stat(sessionId: string, path: string, signal?: AbortSignal): Promise<BotFileStat>
  /** One page of lines of a UTF-8 text file. */
  read(
    sessionId: string,
    path: string,
    range?: BotFileRange,
    signal?: AbortSignal,
  ): Promise<BotFileText>
  /** A byte window, or the complete file under the cap, base64-encoded. */
  readBytes(
    sessionId: string,
    path: string,
    options?: BotByteReadOptions,
    signal?: AbortSignal,
  ): Promise<BotFileBytes>
  /** Direct children of a directory inside the environment's workspace. */
  list(sessionId: string, path: string, signal?: AbortSignal): Promise<BotDirectoryListing>
  /** Files and directories of the workspace whose name or relative path contains the query. */
  search(
    sessionId: string,
    request: BotFileSearchRequest,
    signal?: AbortSignal,
  ): Promise<BotFileSearchResult>
}
