/** Identity and freshness of one file, without its content. */
export interface BotFileStat {
  /** Absolute path in the bot's environment (e.g. `/home/bot/workspace/a.md`). */
  readonly absolutePath: string
  /** Opaque freshness token at the time of the stat; never parsed. */
  readonly version: string
  /** Byte size of the complete file, when the environment reports it. */
  readonly bytes?: number
}

/** A line window: 1-based `offset` (default 1), at most `limit` lines (default and cap: `maxLines`). */
export interface BotFileRange {
  readonly offset?: number
  readonly limit?: number
}

/** One page of a UTF-8 text file. */
export interface BotFileText extends BotFileStat {
  /** First line of the page, as requested. */
  readonly offset: number
  /** The page's lines joined by `\n`, without a terminator after the last. */
  readonly text: string
  /** How many lines the page holds; `0` past the last line. */
  readonly lines: number
  /** Whether the page includes the file's last line. */
  readonly eof: boolean
}

/** A byte window: 0-based `offset` (default 0), at most `length` bytes (default and cap: `maxBytes`). */
export interface BotByteRange {
  readonly offset?: number
  readonly length?: number
}

export interface BotByteReadOptions {
  /** Byte window; omit to read the complete file under `maxFileBytes`. */
  readonly range?: BotByteRange
  /** Base file (absolute or workspace-relative); the relative `path` resolves from its directory. */
  readonly baseFile?: string
}

/** One byte window (or the complete file), base64-encoded. */
export interface BotFileBytes extends BotFileStat {
  readonly offset: number
  /** The bytes, base64; empty at or past the end. */
  readonly base64: string
  /** Whether the window includes the file's last byte. */
  readonly eof: boolean
}

export interface BotDirectoryEntry {
  readonly name: string
  /** What the child resolves to (a symlink reports its destination's type). */
  readonly type: "file" | "directory" | "other"
  readonly size?: number
}

export interface BotDirectoryListing {
  /** The listed directory relative to the workspace, empty for the workspace itself. */
  readonly path: string
  /** Direct children in the environment's order, cut to `maxEntries`. */
  readonly entries: readonly BotDirectoryEntry[]
  readonly truncated: boolean
}

export interface BotFileSearchRequest {
  /** Case-insensitive substring; matches names, or relative paths when it contains `/`. Trimmed, never empty. */
  readonly query: string
  /** Literal exclusions: a name at any depth, or (with `/`) an exact workspace-relative path. */
  readonly excludedPaths?: readonly string[]
  readonly includeHidden?: boolean
  /** ripgrep's ignore rules (`.gitignore`, `.ignore`…); default true. */
  readonly respectGitignore?: boolean
}

export interface BotFileSearchMatch {
  /** `/`-joined workspace-relative path, never empty. */
  readonly path: string
  readonly type: BotDirectoryEntry["type"]
}

export interface BotFileSearchResult {
  /** Files and their inferred ancestor directories, by depth then path, cut to `search.maxResults`. */
  readonly matches: readonly BotFileSearchMatch[]
  /** More matches than `search.maxResults`. */
  readonly truncated: boolean
  /** ripgrep listed more than `search.maxEntries` files (stopped early) or exited with 2. */
  readonly incomplete: boolean
}

/** Every `bot-file/…` failure code the Host's `botFiles` raises. */
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

/** Every code a `botFiles` result carries: the Host's own and the Gateway's refusal of malformed arguments. */
export const BOT_FILE_WIRE_CODES = [...BOT_FILE_ERROR_CODES, "gateway/bad-request"] as const

export type BotFileWireCode = (typeof BOT_FILE_WIRE_CODES)[number]

/** Details of each code, as `RemoteError.details` carries them. */
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
