export interface BotFileStat {
  readonly absolutePath: string
  readonly version: string
  readonly bytes?: number
}

export interface BotFileRange {
  readonly offset?: number
  readonly limit?: number
}

export interface BotFileText extends BotFileStat {
  readonly offset: number
  readonly text: string
  readonly lines: number
  readonly eof: boolean
}

export interface BotByteRange {
  readonly offset?: number
  readonly length?: number
}

export interface BotByteReadOptions {
  readonly range?: BotByteRange
  readonly baseFile?: string
}

export interface BotFileBytes extends BotFileStat {
  readonly offset: number
  readonly base64: string
  readonly eof: boolean
}

export interface BotDirectoryEntry {
  readonly name: string
  readonly type: "file" | "directory" | "other"
  readonly size?: number
}

export interface BotDirectoryListing {
  readonly path: string
  readonly entries: readonly BotDirectoryEntry[]
  readonly truncated: boolean
}

export interface BotFileSearchRequest {
  readonly query: string
  readonly excludedPaths?: readonly string[]
  readonly includeHidden?: boolean
  readonly respectGitignore?: boolean
}

export interface BotFileSearchMatch {
  readonly path: string
  readonly type: BotDirectoryEntry["type"]
}

export interface BotFileSearchResult {
  readonly matches: readonly BotFileSearchMatch[]
  readonly truncated: boolean
  readonly incomplete: boolean
}

export const BOT_FILE_ERROR_CODES = [
  "bot-file/not-bot-session",
  "bot-file/unavailable",
  "bot-file/not-found",
  "bot-file/outside-workspace",
  "bot-file/too-large",
  "bot-file/not-text",
  "bot-file/not-regular-file",
  "bot-file/not-directory",
  "bot-file/permission-denied",
  "bot-file/search-failed",
] as const

export type BotFileErrorCode = (typeof BOT_FILE_ERROR_CODES)[number]

export const BOT_FILE_WIRE_CODES = [...BOT_FILE_ERROR_CODES, "gateway/bad-request"] as const

export type BotFileWireCode = (typeof BOT_FILE_WIRE_CODES)[number]

export interface BotFileErrorDetails {
  readonly "bot-file/not-bot-session": { readonly sessionId: string }
  readonly "bot-file/unavailable": { readonly sessionId: string }
  readonly "bot-file/not-found": { readonly path: string }
  readonly "bot-file/outside-workspace": { readonly path: string }
  readonly "bot-file/too-large": { readonly path: string; readonly limit: number }
  readonly "bot-file/not-text": { readonly path: string }
  readonly "bot-file/not-regular-file": {
    readonly path: string
    readonly kind: "directory" | "symlink" | "other"
  }
  readonly "bot-file/not-directory": {
    readonly path: string
    readonly kind: "file" | "symlink" | "other"
  }
  readonly "bot-file/permission-denied": { readonly path: string }
  readonly "bot-file/search-failed": Record<string, never>
}
