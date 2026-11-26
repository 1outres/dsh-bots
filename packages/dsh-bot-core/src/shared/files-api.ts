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

export interface BotFilesApi {
  stat(sessionId: string, path: string, signal?: AbortSignal): Promise<BotFileStat>
  read(
    sessionId: string,
    path: string,
    range?: BotFileRange,
    signal?: AbortSignal,
  ): Promise<BotFileText>
  readBytes(
    sessionId: string,
    path: string,
    options?: BotByteReadOptions,
    signal?: AbortSignal,
  ): Promise<BotFileBytes>
  list(sessionId: string, path: string, signal?: AbortSignal): Promise<BotDirectoryListing>
  search(
    sessionId: string,
    request: BotFileSearchRequest,
    signal?: AbortSignal,
  ): Promise<BotFileSearchResult>
}
