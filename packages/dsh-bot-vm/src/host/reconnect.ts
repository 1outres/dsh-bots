/**
 * A reconnecting front for dsh-ssh's one-shot `SshConnection`: connects on
 * first use, notices a failed connection, and opens a fresh one for the next
 * call. Calls in flight when a connection fails still fail (dsh-ssh never
 * replays a possibly applied operation); only later calls reconnect.
 *
 * Remote handles (process ids from `process.prepare`, text streams from
 * `fs.stream`, stream endpoints under a helper's root) belong to the
 * connection that issued them. A call naming a handle of a lost connection is
 * never sent to its successor (which would answer "unknown handle" and make
 * the SSH providers tear the healthy successor down): releasing calls resolve
 * `null` (the remote side is gone with its helper), anything else rejects.
 *
 * Connecting is tried `connectAttempts` times per call before the call fails:
 * the first helper start on a VM that just booted reads everything cold and
 * can outlast dsh-ssh's handshake deadline once, then answers in well under a
 * second.
 *
 * A connection with no call in flight, no open stream and no remote handle
 * for `idleMs` is closed; the next call opens a new one. An open SSH
 * connection holds an Incus exec operation, which delays an incusd restart
 * (docs/specs/incus-endpoint.md §8.2).
 */

/** A forwarded stream: the front counts it as activity until it closes. */
export interface ClosableStream {
  once(event: "close", listener: () => void): unknown
}

/** The part of `SshConnection` this front delegates to. */
export interface SshLike<Stream extends ClosableStream = ClosableStream> {
  readonly ready: Promise<unknown>
  readonly ptcLaunch: unknown
  request<T>(
    method: string,
    params: unknown,
    result: { parse(value: unknown): T },
    signal?: AbortSignal,
    wait?: boolean,
  ): Promise<T>
  connectStream(endpoint: { readonly path: string }, signal?: AbortSignal): Promise<Stream>
}

/** One opened connection and the means to tear it down. */
export interface OpenedConnection<C> {
  readonly connection: C
  close(): Promise<void>
}

export interface ReconnectOptions<C> {
  /** Host alias, for error messages. */
  readonly host: string
  /** Start a new connection; it connects in the background and settles `ready`. */
  open(): Promise<OpenedConnection<C>>
  /** Whether a connection has failed or closed, so later calls need a new one. */
  failed(connection: C): boolean
  /** After a failed connect, calls fail fast with that error for this long. */
  readonly retryDelayMs: number
  /** Connections opened for one call before it fails (at least 1). Default 1. */
  readonly connectAttempts?: number
  /** Close a connection unused this long; 0 keeps it open. */
  readonly idleMs: number
  readonly now: () => number
  /** Run `task` after `ms`; returns its cancellation. */
  readonly later: (ms: number, task: () => void) => () => void
  readonly log?: (message: string) => void
}

/**
 * Handles remembered at most. Processes that are never waited for or
 * terminated would otherwise grow the table; past this size the oldest
 * entries go (a forgotten handle of the live connection still works, its
 * calls simply go to the current connection).
 */
export const MAX_HANDLES = 4096

/** Calls that only release a remote handle; on a lost connection there is nothing left to release. */
const RELEASING = new Set(["process.terminate", "fs.streamClose"])

export class LostConnectionError extends Error {
  constructor(host: string, method: string) {
    super(
      `the SSH connection to the bot VM (${host}) that owned this ${method.split(".")[0]} handle was lost; its remote state is gone`,
    )
    this.name = "LostConnectionError"
  }
}

interface Entry<C> {
  readonly pending: Promise<OpenedConnection<C>>
  /** Set once `pending` resolved. */
  opened?: OpenedConnection<C>
  /** The helper's private stream root, once its hello arrived. */
  root?: string
  /** Retired: no call is sent here any more. */
  dead: boolean
  /** Calls in flight and open streams. */
  active: number
}

function handleOf(params: unknown): string | undefined {
  if (typeof params !== "object" || params === null) return undefined
  const id = (params as { id?: unknown }).id
  return typeof id === "string" ? id : undefined
}

function rootOf(hello: unknown): string | undefined {
  if (typeof hello !== "object" || hello === null) return undefined
  const root = (hello as { root?: unknown }).root
  return typeof root === "string" ? root : undefined
}

/** Resolve with `promise`, or reject as soon as `signal` aborts. */
function raced<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort)
        reject(error)
      },
    )
  })
}

export class Reconnector<C extends SshLike> {
  private current: Entry<C> | undefined
  private lastFailure: { readonly error: Error; readonly at: number } | undefined
  /** The connection the most recent failed call ran on. */
  private lastCallFailure: Entry<C> | undefined
  private closed = false
  /** Remote handle id → the connection that issued it. */
  private readonly handles = new Map<string, Entry<C>>()
  /** Connections with a known stream root, newest last (dead ones kept for routing). */
  private readonly roots: Entry<C>[] = []
  private cancelIdle: (() => void) | undefined

  constructor(private readonly options: ReconnectOptions<C>) {}

  /** The live connection, connecting (again) when there is none. */
  async connection(signal?: AbortSignal): Promise<C> {
    const entry = await this.live(signal)
    this.settle(entry)
    return entry.opened?.connection as C
  }

  /** The connection whose helper has answered, if any; never connects. */
  connected(): C | undefined {
    const entry = this.current
    const connection = entry?.root === undefined ? undefined : entry.opened?.connection
    if (connection === undefined || this.options.failed(connection)) return undefined
    return connection
  }

  async request<T>(
    method: string,
    params: unknown,
    result: { parse(value: unknown): T },
    signal?: AbortSignal,
    wait?: boolean,
  ): Promise<T> {
    const id = handleOf(params)
    const owner = id === undefined ? undefined : this.handles.get(id)
    if (id !== undefined && owner !== undefined && this.isGone(owner)) {
      // Kept in the map: later calls for the handle must still not reach the successor.
      if (RELEASING.has(method)) return null as T
      throw new LostConnectionError(this.options.host, method)
    }
    const entry = owner ?? (await this.live(signal))
    const value = await this.call(
      entry,
      (connection) => connection.request(method, params, result, signal, wait),
      signal,
    )
    this.track(method, id, value, entry)
    this.settle(entry)
    return value
  }

  async connectStream(
    endpoint: { readonly path: string },
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<C["connectStream"]>>> {
    const owner = this.roots.find(
      (entry) => entry.root !== undefined && endpoint.path.startsWith(`${entry.root}/`),
    )
    if (owner !== undefined && this.isGone(owner)) {
      throw new LostConnectionError(this.options.host, "stream.connect")
    }
    const entry = owner ?? (await this.live(signal))
    const stream = await this.call(
      entry,
      (connection) => connection.connectStream(endpoint, signal),
      signal,
    )
    entry.active++
    stream.once("close", () => {
      entry.active--
      this.settle(entry)
    })
    return stream as Awaited<ReturnType<C["connectStream"]>>
  }

  /**
   * A consumer could not confirm remote cleanup and gives the connection up:
   * close it, but only when the most recent failed call ran on the current
   * connection (a failure on a lost one says nothing about its successor).
   */
  async reset(): Promise<void> {
    const entry = this.current
    if (entry !== undefined && entry === this.lastCallFailure) await this.retire(entry)
  }

  /** Close for good. */
  async close(): Promise<void> {
    this.closed = true
    const entry = this.current
    if (entry !== undefined) await this.retire(entry)
  }

  private isGone(entry: Entry<C>): boolean {
    if (entry.dead) return true
    if (entry.opened !== undefined && this.options.failed(entry.opened.connection)) {
      void this.retire(entry)
      return true
    }
    return false
  }

  private async call<T>(
    entry: Entry<C>,
    invoke: (connection: C) => Promise<T>,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    this.stopIdleTimer()
    entry.active++
    try {
      const connection = (await entry.pending).connection
      try {
        return await invoke(connection)
      } catch (error) {
        if (this.options.failed(connection)) void this.retire(entry)
        else if (!signal?.aborted) this.lastCallFailure = entry
        throw error
      }
    } finally {
      entry.active--
      this.settle(entry)
    }
  }

  private busy(entry: Entry<C>): boolean {
    if (entry.active > 0) return true
    for (const owner of this.handles.values()) if (owner === entry) return true
    return false
  }

  private stopIdleTimer(): void {
    this.cancelIdle?.()
    this.cancelIdle = undefined
  }

  /** Start the idle countdown of the current connection once nothing uses it. */
  private settle(entry: Entry<C>): void {
    if (this.options.idleMs <= 0 || entry !== this.current || entry.dead || this.busy(entry)) return
    this.stopIdleTimer()
    this.cancelIdle = this.options.later(this.options.idleMs, () => {
      this.cancelIdle = undefined
      if (entry !== this.current || entry.dead || this.busy(entry)) return
      this.options.log?.(`closing the idle connection to ${this.options.host}`)
      void this.retire(entry)
    })
  }

  /** Remember which connection issued a handle; forget released ones. */
  private track(method: string, id: string | undefined, value: unknown, entry: Entry<C>): void {
    if (method === "process.prepare") {
      const issued = handleOf(value)
      if (issued !== undefined) this.remember(issued, entry)
    } else if (method === "fs.stream" && typeof value === "string") {
      this.remember(value, entry)
    } else if (id !== undefined) {
      const finished =
        RELEASING.has(method) ||
        (method === "process.wait" && value === true) ||
        (method === "fs.next" && (value as { done?: unknown } | null)?.done === true)
      if (finished) this.handles.delete(id)
    }
  }

  private remember(id: string, entry: Entry<C>): void {
    this.handles.set(id, entry)
    while (this.handles.size > MAX_HANDLES) {
      const oldest = this.handles.keys().next().value
      if (oldest === undefined) break
      this.handles.delete(oldest)
    }
  }

  /** Number of remembered handles (for tests). */
  handleCount(): number {
    return this.handles.size
  }

  /** The current connection once its helper answered; opens one when there is none. */
  private async live(signal: AbortSignal | undefined): Promise<Entry<C>> {
    const attempts = Math.max(1, Math.floor(this.options.connectAttempts ?? 1))
    for (let attempt = 1; ; attempt++) {
      // Only the first attempt of a call honours an earlier call's failure.
      const entry = this.entry(attempt === 1)
      try {
        const opened = await raced(entry.pending, signal)
        const hello = await raced(opened.connection.ready, signal)
        if (entry.root === undefined) {
          entry.root = rootOf(hello)
          if (entry.root !== undefined) this.roots.push(entry)
        }
        this.lastFailure = undefined
        return entry
      } catch (cause) {
        if (signal?.aborted) throw cause
        void this.retire(entry)
        const message = cause instanceof Error ? cause.message : String(cause)
        if (attempt < attempts && !this.closed) {
          this.options.log?.(`connecting to ${this.options.host} failed (${message}); trying again`)
          continue
        }
        // No `cause`: the message already carries it, and DSH renders an
        // error with its whole cause chain (dsh-fs-ssh wraps this one again),
        // which would repeat the same text.
        const error = new Error(
          `cannot reach the bot VM over SSH (${this.options.host}): ${message}`,
        )
        this.lastFailure = { error, at: this.options.now() }
        throw error
      }
    }
  }

  private entry(honourFailure = true): Entry<C> {
    if (this.closed) throw new Error("SSH connection is closed")
    const current = this.current
    if (current !== undefined && !this.isGone(current)) return current
    const failure = this.lastFailure
    if (
      honourFailure &&
      failure !== undefined &&
      this.options.now() - failure.at < this.options.retryDelayMs
    ) {
      throw failure.error
    }
    this.options.log?.(`connecting to ${this.options.host}`)
    const pending = this.options.open()
    const entry: Entry<C> = { pending, dead: false, active: 0 }
    void pending.then(
      (opened) => {
        entry.opened = opened
        // The front reports connect failures itself; the raw promise must not go unhandled.
        void opened.connection.ready.catch(() => {})
      },
      () => {},
    )
    this.current = entry
    return entry
  }

  private async retire(entry: Entry<C>): Promise<void> {
    if (entry.dead) return
    entry.dead = true
    if (this.current === entry) {
      this.current = undefined
      this.stopIdleTimer()
    }
    // Keep only the handles and roots of a few lost connections for routing.
    const deadRoots = this.roots.filter((root) => root.dead)
    for (const stale of deadRoots.slice(0, Math.max(0, deadRoots.length - 8))) {
      this.roots.splice(this.roots.indexOf(stale), 1)
      for (const [id, owner] of this.handles) if (owner === stale) this.handles.delete(id)
    }
    const opened = await entry.pending.catch(() => undefined)
    await opened?.close().catch(() => {})
  }
}
