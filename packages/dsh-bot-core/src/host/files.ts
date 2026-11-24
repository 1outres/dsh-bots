import { posix } from "node:path"
import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import type {
  BotByteRange,
  BotDirectoryEntry,
  BotFileErrorDetails,
  BotFileRange,
  BotFileSearchMatch,
  BotFileSearchRequest,
  BotFileStat,
} from "../shared/files"
import type { BotFilesApi } from "../shared/files-api"
import { botFileErrorOf, type FsFailureSubject, fsFailureOf } from "./fs-failure"

declare module "@deepseek-ai/dsh-typert-protocol" {
  interface RemoteErrorDetailsMap extends BotFileErrorDetails {}
}

/** A file system target; opaque here. */
export type FileTarget = object

/** dsh-fs `FileSystem`, structurally. */
export interface EnvironmentFileSystem {
  resolve(path: string, options?: { cwd?: string; signal?: AbortSignal }): Promise<FileTarget>
  processPath(target: FileTarget): string
  contains(parent: FileTarget, child: FileTarget): boolean
  stat(
    target: FileTarget,
    signal?: AbortSignal,
  ): Promise<
    | {
        readonly version: string
        readonly type: "file" | "directory" | "other"
        readonly size?: number
      }
    | undefined
  >
  lstat(
    path: string,
    options?: { cwd?: string },
    signal?: AbortSignal,
  ): Promise<
    | {
        readonly version: string
        readonly type: "file" | "directory" | "symlink" | "other"
        readonly size?: number
      }
    | undefined
  >
  streamText(target: FileTarget, signal?: AbortSignal): Promise<AsyncIterable<string>>
  readBytes(
    target: FileTarget,
    signal: AbortSignal | undefined,
    maxBytes: number,
  ): Promise<Uint8Array>
  readByteRange(
    target: FileTarget,
    range: { offset: number; length: number },
    signal?: AbortSignal,
  ): Promise<Uint8Array>
  listDir(
    target: FileTarget,
    signal?: AbortSignal,
  ): Promise<
    readonly {
      readonly name: string
      readonly type: "file" | "directory" | "other"
      readonly size?: number
    }[]
  >
}

/** A piped dsh-subprocess stdout (`Readable`), structurally; it yields strings once its encoding is set. */
export interface EnvironmentOutput extends AsyncIterable<string> {
  setEncoding(encoding: "utf8"): unknown
  destroy(): unknown
}

/** dsh-subprocess `SubprocessHandle` of a spawn with piped stdout and collected stderr, structurally. */
export interface EnvironmentProcess {
  readonly stdout: EnvironmentOutput
  readonly collected: {
    readonly stderr: { readFrom(offset: number): { readonly text: string } }
  }
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>
  terminate(): void
  waitForExit(signal?: AbortSignal): Promise<boolean>
}

/** dsh-subprocess `SubprocessRuntime`, structurally. */
export interface EnvironmentSubprocess {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: { stdin: "ignore"; stdout: "pipe"; stderr: { maxBytes: number } }
    graceMs: number
    signal: AbortSignal
  }): EnvironmentProcess
  resolveExecutable(command: string, env: undefined, signal: AbortSignal): Promise<string>
}

/** The services of one bot's environment; a group without a subprocess service cannot search. */
export interface EnvironmentFiles {
  readonly fs: EnvironmentFileSystem
  readonly subprocess: EnvironmentSubprocess | undefined
}

/** Caps, named as `workspaceFiles` names them (bot-core's `files` config). */
export interface BotFilesLimits {
  /** Inclusive byte cap on one page's text and on one byte window. */
  readonly maxBytes: number
  /** Inclusive byte cap on a complete-file `readBytes`. */
  readonly maxFileBytes: number
  /** Default and largest page in lines. */
  readonly maxLines: number
  /** Cap on returned directory entries. */
  readonly maxEntries: number
  /** Refuse `read`/`readBytes`/`stat` of paths outside the workspace. */
  readonly confineReads: boolean
  /** Calls served at once per bot; more wait their turn (or their caller's abort). */
  readonly maxConcurrent: number
  readonly search: {
    readonly maxResults: number
    readonly maxEntries: number
    readonly graceMs: number
    readonly timeoutMs: number
    readonly stderrMaxBytes: number
    /** ripgrep in the environment: a path used as is, or a command the environment resolves. */
    readonly ripgrep: string
  }
}

// workspaceFiles' defaults, except maxFileBytes: a complete file travels base64 over SSH and again in JSON.
export const DEFAULT_FILES_LIMITS: BotFilesLimits = {
  maxBytes: 2 * 1024 * 1024,
  maxFileBytes: 8 * 1024 * 1024,
  maxLines: 5000,
  maxEntries: 2000,
  confineReads: false,
  maxConcurrent: 4,
  search: {
    maxResults: 512,
    maxEntries: 100_000,
    graceMs: 3000,
    timeoutMs: 30_000,
    stderrMaxBytes: 65_536,
    ripgrep: "rg",
  },
}

export interface BotFilesDeps {
  /** The stored bot whose session `sessionId` is, or undefined. */
  botOfSession(sessionId: string): string | undefined
  /** The bot's environment services, from its own composed preset, or undefined. */
  environmentOf(botId: string): EnvironmentFiles | undefined
  /** The registered environment's workspace, or undefined without one. */
  workspace(): string | undefined
  readonly limits: BotFilesLimits
  /** A signal that aborts after `ms` (search deadline). */
  deadline(ms: number): AbortSignal
  /** Reports what an answer cannot carry: an environment failure behind `bot-file/unavailable`, a process left unobserved. */
  warn(message: string): void
}

/** The Host's `botFiles` service. */
export type BotFiles = BotFilesApi

interface Scope {
  readonly sessionId: string
  readonly botId: string
  readonly fs: EnvironmentFileSystem
  readonly subprocess: EnvironmentSubprocess | undefined
  readonly workspace: string
}

interface ProcessOutcome {
  /** The listing was cut short by bot-core (entry cap), not by ripgrep. */
  readonly stopped: boolean
  readonly exitCode: number | null
  readonly signal: string | null
  readonly stderr: string
}

const NUL = String.fromCharCode(0)
const encoder = new TextEncoder()
const quote = (value: string) => JSON.stringify(value)
const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

const bad = (message: string) => new RemoteError("gateway/bad-request", message, {})

/** Most entries `excludedPaths` may hold, and the longest one (and the longest query). */
export const MAX_EXCLUDED_PATHS = 256
export const MAX_SEARCH_TEXT = 1024

const VCS_NAMES = [".git", ".svn", ".hg", ".bzr", ".jj", ".sl"]

function integerAtLeast(value: unknown, min: number, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
    throw bad(`${name} must be a safe integer of at least ${min}`)
  }
  return value
}

function isRemoteError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "isDSHRemoteError" in error
}

function causeChain(error: unknown): string {
  const parts: string[] = []
  for (let current = error; current !== undefined && parts.length < 8; ) {
    parts.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join(" <- ")
}

/** Lines `offset` .. `offset + limit - 1` of decoded chunks, stopping past the page (workspaceFiles' page cutter). */
async function cutPage(
  chunks: AsyncIterable<string>,
  offset: number,
  limit: number,
  maxBytes: number,
  path: string,
): Promise<{ text: string; lines: number; eof: boolean }> {
  const last = offset + limit - 1
  const lines: string[] = []
  let current = ""
  let bytes = 0
  let lineNumber = 1
  const admit = (size: number) => {
    bytes += size
    if (bytes > maxBytes) {
      throw new RemoteError(
        "bot-file/too-large",
        `lines ${offset}-${last} of ${quote(path)} exceed the ${maxBytes} byte cap`,
        { path, limit: maxBytes },
      )
    }
  }
  const complete = () => {
    if (lines.length > 0) admit(1)
    lines.push(current)
    current = ""
  }
  for await (const chunk of chunks) {
    let position = 0
    while (position < chunk.length) {
      if (lineNumber > last) return { text: lines.join("\n"), lines: lines.length, eof: false }
      const newline = chunk.indexOf("\n", position)
      const segment = newline === -1 ? chunk.slice(position) : chunk.slice(position, newline)
      if (lineNumber >= offset) {
        admit(encoder.encode(segment).length)
        current += segment
      }
      if (newline === -1) break
      if (lineNumber >= offset) complete()
      lineNumber += 1
      position = newline + 1
    }
  }
  if (current.length > 0) complete()
  return { text: lines.join("\n"), lines: lines.length, eof: true }
}

/** A literal rg glob exclusion. */
function exclusion(path: string): string {
  const literal = path.replace(/[\\*?[\]{}!]/g, "\\$&")
  return `--glob=!${path.includes("/") ? "/" : ""}${literal}`
}

function ripgrepFlags(request: BotFileSearchRequest, excluded: readonly string[]): string[] {
  return [
    "--no-config",
    "--files",
    "--sort=path",
    "--null",
    "--path-separator=/",
    ...(request.includeHidden === true ? ["--hidden"] : []),
    ...(request.respectGitignore === false ? ["--no-ignore"] : []),
    ...[...VCS_NAMES, ...excluded].map(exclusion),
  ]
}

function checkExcluded(value: unknown): readonly string[] {
  const excluded = value ?? []
  if (
    !Array.isArray(excluded) ||
    excluded.length > MAX_EXCLUDED_PATHS ||
    excluded.some(
      (path) =>
        typeof path !== "string" ||
        path.length === 0 ||
        path.length > MAX_SEARCH_TEXT ||
        path.includes(NUL),
    )
  ) {
    throw bad(
      `excludedPaths must be at most ${MAX_EXCLUDED_PATHS} non-empty strings of at most ${MAX_SEARCH_TEXT} characters`,
    )
  }
  return excluded
}

function checkQuery(request: BotFileSearchRequest | undefined): string {
  const query = typeof request?.query === "string" ? request.query.trim() : ""
  if (query.length === 0) throw bad("query must not be blank")
  if (query.length > MAX_SEARCH_TEXT) {
    throw bad(`query must be at most ${MAX_SEARCH_TEXT} characters`)
  }
  return query
}

/** Collects the files ripgrep lists, and their directories, whose name (or path, for a query with "/") matches. */
function createMatcher(query: string) {
  const needle = query.toLowerCase()
  const byPath = query.includes("/")
  const found = new Map<string, BotFileSearchMatch>()
  const admit = (path: string, type: BotFileSearchMatch["type"]) => {
    const name = path.slice(path.lastIndexOf("/") + 1)
    if ((byPath ? path : name).toLowerCase().includes(needle)) found.set(path, { path, type })
  }
  return {
    file(path: string) {
      admit(path, "file")
      for (let end = path.lastIndexOf("/"); end !== -1; end = path.lastIndexOf("/", end - 1)) {
        admit(path.slice(0, end), "directory")
      }
    },
    matches(): BotFileSearchMatch[] {
      return [...found.values()].sort((a, b) => {
        const depth = a.path.split("/").length - b.path.split("/").length
        return depth || (a.path < b.path ? -1 : 1)
      })
    },
  }
}

/** Read NUL-separated records from a process; `onRecord` returning false stops it. Resolves whether it was stopped. */
async function readRecords(
  handle: EnvironmentProcess,
  signal: AbortSignal,
  onRecord: (record: string) => boolean,
): Promise<boolean> {
  const { stdout } = handle
  // The provider terminates on the spec's signal too; this does not rely on it.
  const stop = () => {
    handle.terminate()
    stdout.destroy()
  }
  if (signal.aborted) stop()
  signal.addEventListener("abort", stop, { once: true })
  stdout.setEncoding("utf8")
  let pending = ""
  let stopped = false
  try {
    for await (const chunk of stdout) {
      if (stopped) continue
      pending += chunk
      let end = pending.indexOf(NUL)
      while (end !== -1) {
        const record = pending.slice(0, end)
        pending = pending.slice(end + 1)
        if (!onRecord(record)) {
          stopped = true
          pending = ""
          handle.terminate()
          break
        }
        end = pending.indexOf(NUL)
      }
    }
    if (!stopped && pending.length > 0 && !onRecord(pending)) stopped = true
    return stopped
  } catch (error) {
    stop()
    throw error
  } finally {
    signal.removeEventListener("abort", stop)
  }
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64")
}

export function createBotFiles(deps: BotFilesDeps): BotFiles {
  const limits = deps.limits

  const scopeOf = (sessionId: unknown): Scope => {
    if (typeof sessionId !== "string" || sessionId === "") throw bad("sessionId is required")
    const botId = deps.botOfSession(sessionId)
    if (botId === undefined) {
      throw new RemoteError(
        "bot-file/not-bot-session",
        `session ${quote(sessionId)} is not a session of a bot`,
        { sessionId },
      )
    }
    const environment = deps.environmentOf(botId)
    const workspace = deps.workspace()
    if (environment === undefined || workspace === undefined) {
      throw new RemoteError(
        "bot-file/unavailable",
        `the environment of bot "${botId}" is not ready, so its files cannot be read`,
        { sessionId },
      )
    }
    return { sessionId, botId, fs: environment.fs, subprocess: environment.subprocess, workspace }
  }

  const slots = new Map<string, { active: number; readonly waiting: (() => void)[] }>()

  const acquire = (botId: string, signal: AbortSignal | undefined): Promise<void> => {
    signal?.throwIfAborted()
    const slot = slots.get(botId) ?? { active: 0, waiting: [] }
    slots.set(botId, slot)
    if (slot.active < limits.maxConcurrent) {
      slot.active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        const index = slot.waiting.indexOf(wake)
        if (index !== -1) slot.waiting.splice(index, 1)
        reject(signal?.reason)
      }
      const wake = () => {
        signal?.removeEventListener("abort", onAbort)
        slot.active += 1
        resolve()
      }
      slot.waiting.push(wake)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  const release = (botId: string) => {
    const slot = slots.get(botId)
    if (slot === undefined) return
    slot.active -= 1
    const next = slot.waiting.shift()
    if (next !== undefined) next()
    else if (slot.active === 0) slots.delete(botId)
  }

  /** Run `work` in one of the bot's turns, answering the environment's failures as `bot-file/…` errors. */
  const guarded = async <T>(
    scope: Scope,
    subject: FsFailureSubject,
    signal: AbortSignal | undefined,
    work: () => Promise<T>,
  ): Promise<T> => {
    await acquire(scope.botId, signal)
    try {
      return await work()
    } catch (error) {
      if (isRemoteError(error)) throw error
      const failure = fsFailureOf(error)
      if (signal?.aborted === true && (error === signal.reason || failure === "aborted")) {
        throw error
      }
      const translated = botFileErrorOf(failure, {
        sessionId: scope.sessionId,
        subject,
        description: `${quote(subject.path)}: ${describe(error)}`,
        cause: error,
      })
      if (translated.code === "bot-file/unavailable") {
        deps.warn(
          `bot-core: botFiles of bot "${scope.botId}": ${translated.message}; cause: ${causeChain(error)}`,
        )
      }
      throw translated
    } finally {
      release(scope.botId)
    }
  }

  const checkPath = (path: unknown): string => {
    if (typeof path !== "string" || path.length === 0) throw bad("path is required")
    if (path.includes(NUL)) throw bad("path must not contain NUL")
    return path
  }

  /** Every gate for a regular file, ending in the stat that names its version and size. */
  const locateFile = async (scope: Scope, path: string, signal: AbortSignal | undefined) => {
    const { fs, workspace } = scope
    const entry = await fs.lstat(path, { cwd: workspace }, signal)
    if (entry === undefined) {
      throw new RemoteError("bot-file/not-found", `no entry at ${quote(path)}`, { path })
    }
    if (entry.type !== "file") {
      throw new RemoteError("bot-file/not-regular-file", `${quote(path)} is a ${entry.type}`, {
        path,
        kind: entry.type,
      })
    }
    const target = await fs.resolve(path, { cwd: workspace, ...(signal ? { signal } : {}) })
    if (limits.confineReads) {
      const root = await fs.resolve(workspace, signal ? { signal } : {})
      if (!fs.contains(root, target)) {
        throw new RemoteError(
          "bot-file/outside-workspace",
          `${quote(path)} is outside the workspace`,
          { path },
        )
      }
    }
    const info = await fs.stat(target, signal)
    if (info === undefined) {
      throw new RemoteError("bot-file/not-found", `no entry at ${quote(path)}`, { path })
    }
    if (info.type !== "file") {
      throw new RemoteError("bot-file/not-regular-file", `${quote(path)} is a ${info.type}`, {
        path,
        kind: info.type,
      })
    }
    const stat: BotFileStat = {
      absolutePath: fs.processPath(target),
      version: String(info.version),
      ...(info.size === undefined ? {} : { bytes: info.size }),
    }
    return { target, info, stat }
  }

  const resolvePage = (range: BotFileRange | undefined) => {
    const offset = range?.offset === undefined ? 1 : integerAtLeast(range.offset, 1, "offset")
    const limit =
      range?.limit === undefined ? limits.maxLines : integerAtLeast(range.limit, 1, "limit")
    if (limit > limits.maxLines) throw bad(`limit must be at most ${limits.maxLines}`)
    return { offset, limit }
  }

  const resolveWindow = (range: BotByteRange, path: string) => {
    const offset = range.offset === undefined ? 0 : integerAtLeast(range.offset, 0, "offset")
    const length =
      range.length === undefined ? limits.maxBytes : integerAtLeast(range.length, 1, "length")
    if (offset + length > Number.MAX_SAFE_INTEGER) {
      throw bad("offset plus length must stay a safe integer")
    }
    if (length > limits.maxBytes) {
      throw new RemoteError(
        "bot-file/too-large",
        `${length} bytes of ${quote(path)} exceed the ${limits.maxBytes} byte cap`,
        { path, limit: limits.maxBytes },
      )
    }
    return { offset, length }
  }

  /** `path` relative to the directory of `baseFile`. */
  const relativeTo = async (
    scope: Scope,
    baseFile: string,
    path: string,
    signal: AbortSignal | undefined,
  ) => {
    if (path.startsWith("/") || /^[a-z][a-z\d+.-]*:/iu.test(path)) {
      throw bad("path must be relative when baseFile is provided")
    }
    const { stat } = await locateFile(scope, checkPath(baseFile), signal)
    return posix.resolve(posix.dirname(stat.absolutePath), path)
  }

  /** Run ripgrep's listing in the workspace, feeding each listed file to `onFile` until it returns false. */
  const runListing = async (
    scope: Scope,
    subprocess: EnvironmentSubprocess,
    flags: readonly string[],
    root: string,
    signal: AbortSignal,
    onFile: (path: string) => boolean,
  ): Promise<ProcessOutcome> => {
    const search = limits.search
    const executable = search.ripgrep.includes("/")
      ? search.ripgrep
      : await subprocess.resolveExecutable(search.ripgrep, undefined, signal)
    const handle = subprocess.spawn({
      argv: [executable, ...flags],
      cwd: root,
      stdio: { stdin: "ignore", stdout: "pipe", stderr: { maxBytes: search.stderrMaxBytes } },
      graceMs: search.graceMs,
      signal,
    })
    let stopped: boolean
    let exit: { readonly exitCode: number | null; readonly signal: string | null }
    try {
      stopped = await readRecords(handle, signal, onFile)
      exit = await handle.done
    } finally {
      await handle.waitForExit().catch((error: unknown) => {
        deps.warn(
          `bot-core: could not observe ripgrep's exit in the environment of bot "${scope.botId}": ${causeChain(error)}`,
        )
      })
    }
    const stderr = handle.collected.stderr.readFrom(0).text.trim()
    return { stopped, exitCode: exit.exitCode, signal: exit.signal, stderr }
  }

  return {
    async stat(sessionId, path, signal) {
      const scope = scopeOf(sessionId)
      checkPath(path)
      return guarded(
        scope,
        { kind: "uncapped", path },
        signal,
        async () => (await locateFile(scope, path, signal)).stat,
      )
    },

    async read(sessionId, path, range, signal) {
      const scope = scopeOf(sessionId)
      checkPath(path)
      const { offset, limit } = resolvePage(range)
      const subject: FsFailureSubject = { kind: "capped", path, limit: limits.maxBytes }
      return guarded(scope, subject, signal, async () => {
        const { target, stat } = await locateFile(scope, path, signal)
        const page = await cutPage(
          await scope.fs.streamText(target, signal),
          offset,
          limit,
          limits.maxBytes,
          path,
        )
        if (page.text.includes(NUL)) {
          throw new RemoteError("bot-file/not-text", `${quote(path)} contains NUL bytes`, { path })
        }
        return { ...stat, offset, text: page.text, lines: page.lines, eof: page.eof }
      })
    },

    async readBytes(sessionId, path, options, signal) {
      const scope = scopeOf(sessionId)
      checkPath(path)
      const window = options?.range === undefined ? undefined : resolveWindow(options.range, path)
      const limit = window === undefined ? limits.maxFileBytes : limits.maxBytes
      return guarded(scope, { kind: "capped", path, limit }, signal, async () => {
        const resolved =
          options?.baseFile === undefined
            ? path
            : await relativeTo(scope, options.baseFile, path, signal)
        const { target, info, stat } = await locateFile(scope, resolved, signal)
        if (window !== undefined) {
          const data = await scope.fs.readByteRange(target, window, signal)
          // Without a size from the environment, a short window is the end of the file.
          const eof =
            info.size === undefined
              ? data.length < window.length
              : window.offset + data.length >= info.size
          return { ...stat, offset: window.offset, base64: toBase64(data), eof }
        }
        if (info.size !== undefined && info.size > limit) {
          throw new RemoteError(
            "bot-file/too-large",
            `${quote(path)} exceeds the ${limit} byte full-file cap`,
            { path, limit },
          )
        }
        const data = await scope.fs.readBytes(target, signal, limit)
        return { ...stat, offset: 0, base64: toBase64(data), eof: true }
      })
    },

    async list(sessionId, path, signal) {
      const scope = scopeOf(sessionId)
      if (typeof path !== "string" || path.includes(NUL)) throw bad("path must be a string")
      const wanted = path === "" ? "." : path
      return guarded(scope, { kind: "uncapped", path: wanted }, signal, async () => {
        const { fs, workspace } = scope
        const options = signal ? { signal } : {}
        const root = await fs.resolve(workspace, options)
        const entry = await fs.lstat(wanted, { cwd: workspace }, signal)
        if (entry === undefined) {
          throw new RemoteError("bot-file/not-found", `no entry at ${quote(wanted)}`, {
            path: wanted,
          })
        }
        if (entry.type !== "directory" && entry.type !== "symlink") {
          throw new RemoteError("bot-file/not-directory", `${quote(wanted)} is a ${entry.type}`, {
            path: wanted,
            kind: entry.type,
          })
        }
        const target = await fs.resolve(wanted, { cwd: workspace, ...options })
        if (!fs.contains(root, target)) {
          throw new RemoteError(
            "bot-file/outside-workspace",
            `${quote(wanted)} is outside the workspace`,
            { path: wanted },
          )
        }
        if (entry.type === "symlink") {
          const info = await fs.stat(target, signal)
          if (info?.type !== "directory") {
            throw new RemoteError(
              "bot-file/not-directory",
              `${quote(wanted)} does not resolve to a directory`,
              { path: wanted, kind: "symlink" },
            )
          }
        }
        const children = await fs.listDir(target, signal)
        const entries: BotDirectoryEntry[] = children.slice(0, limits.maxEntries).map((child) => ({
          name: child.name,
          type: child.type,
          ...(child.size === undefined ? {} : { size: child.size }),
        }))
        return {
          path: posix.relative(fs.processPath(root), fs.processPath(target)),
          entries,
          truncated: children.length > limits.maxEntries,
        }
      })
    },

    async search(sessionId, request, signal) {
      const scope = scopeOf(sessionId)
      const query = checkQuery(request)
      const flags = ripgrepFlags(request, checkExcluded(request.excludedPaths))
      const search = limits.search
      return guarded(scope, { kind: "uncapped", path: scope.workspace }, signal, async () => {
        const { fs, workspace } = scope
        const root = await fs.resolve(workspace, signal ? { signal } : {})
        const info = await fs.stat(root, signal)
        if (info === undefined) {
          throw new RemoteError("bot-file/not-found", `no entry at ${quote(workspace)}`, {
            path: workspace,
          })
        }
        if (info.type !== "directory") {
          throw new RemoteError("bot-file/not-directory", `${quote(workspace)} is a ${info.type}`, {
            path: workspace,
            kind: info.type,
          })
        }
        const subprocess = scope.subprocess
        if (subprocess === undefined) {
          throw new RemoteError(
            "bot-file/search-failed",
            "searching a bot's files needs its environment's subprocess service",
            {},
          )
        }
        const timeout = deps.deadline(search.timeoutMs)
        const combined = signal === undefined ? timeout : AbortSignal.any([signal, timeout])
        const timedOut = () =>
          new RemoteError(
            "bot-file/search-failed",
            `searching the bot's files took longer than ${search.timeoutMs} ms (files.search.timeoutMs)`,
            {},
          )
        const matcher = createMatcher(query)
        let listed = 0
        let outcome: ProcessOutcome
        try {
          outcome = await runListing(
            scope,
            subprocess,
            flags,
            fs.processPath(root),
            combined,
            (path) => {
              if (listed === search.maxEntries) return false
              matcher.file(path)
              listed += 1
              return true
            },
          )
        } catch (cause) {
          signal?.throwIfAborted()
          if (timeout.aborted) throw timedOut()
          throw new RemoteError(
            "bot-file/search-failed",
            `could not run ripgrep (${quote(search.ripgrep)}) in the bot's environment: ${describe(cause)}`,
            {},
            { cause },
          )
        }
        signal?.throwIfAborted()
        if (timeout.aborted) throw timedOut()
        const { stopped, exitCode, stderr } = outcome
        // rg exits 1 when it lists nothing and 2 after errors it skipped (a partial listing).
        if (
          !stopped &&
          (outcome.signal !== null || (exitCode !== 0 && exitCode !== 1 && exitCode !== 2))
        ) {
          throw new RemoteError(
            "bot-file/search-failed",
            `ripgrep exited with code ${exitCode} and signal ${outcome.signal}${stderr.length > 0 ? `: ${stderr}` : ""}`,
            {},
          )
        }
        const matches = matcher.matches()
        return {
          matches: matches.slice(0, search.maxResults),
          truncated: matches.length > search.maxResults,
          incomplete: stopped || exitCode === 2,
        }
      })
    },
  }
}

/**
 * Per bot, what its preset's `files` rows hand over while mounted (one per live
 * revision), each under its revision's token. Only the newest with the asked
 * token is served, so a retired revision never wins over the registered one.
 */
export interface EnvironmentFilesKeeper<T> {
  /** Called by a bot preset's row while it is active; the returned function detaches it. */
  attach(botId: string, token: string, files: T): () => void
  /** The newest value attached for the bot with `token`. */
  get(botId: string, token: string): T | undefined
  /** Called with the bot after a value was attached or detached. */
  subscribe(listener: (botId: string) => void): () => void
}

export function createEnvironmentFilesKeeper<T>(): EnvironmentFilesKeeper<T> {
  const attached = new Map<string, { readonly token: string; readonly files: T }[]>()
  const listeners = new Set<(botId: string) => void>()
  const changed = (botId: string) => {
    for (const listener of [...listeners]) listener(botId)
  }
  return {
    attach(botId, token, files) {
      const entry = { token, files }
      const list = attached.get(botId) ?? []
      list.push(entry)
      attached.set(botId, list)
      changed(botId)
      return () => {
        const current = attached.get(botId)
        if (current === undefined) return
        const index = current.indexOf(entry)
        if (index === -1) return
        current.splice(index, 1)
        if (current.length === 0) attached.delete(botId)
        changed(botId)
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get(botId, token) {
      const list = attached.get(botId) ?? []
      for (let index = list.length - 1; index >= 0; index--) {
        const entry = list[index]
        if (entry !== undefined && entry.token === token) return entry.files
      }
      return undefined
    },
  }
}
