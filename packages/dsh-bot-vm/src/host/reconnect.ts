export interface ClosableStream {
  once(event: "close", listener: () => void): unknown
}

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

export interface OpenedConnection<C> {
  readonly connection: C
  close(): Promise<void>
}

export interface ReconnectOptions<C> {
  readonly host: string
  open(): Promise<OpenedConnection<C>>
  failed(connection: C): boolean
  readonly retryDelayMs: number
  readonly connectAttempts?: number
  readonly idleMs: number
  readonly now: () => number
  readonly later: (ms: number, task: () => void) => () => void
  readonly log?: (message: string) => void
}

export const MAX_HANDLES = 4096

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
  opened?: OpenedConnection<C>
  root?: string
  dead: boolean
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
  private lastCallFailure: Entry<C> | undefined
  private closed = false
  private readonly handles = new Map<string, Entry<C>>()
  private readonly roots: Entry<C>[] = []
  private cancelIdle: (() => void) | undefined

  constructor(private readonly options: ReconnectOptions<C>) {}

  async connection(signal?: AbortSignal): Promise<C> {
    const entry = await this.live(signal)
    this.settle(entry)
    return entry.opened?.connection as C
  }

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

  async reset(): Promise<void> {
    const entry = this.current
    if (entry !== undefined && entry === this.lastCallFailure) await this.retire(entry)
  }

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

  handleCount(): number {
    return this.handles.size
  }

  private async live(signal: AbortSignal | undefined): Promise<Entry<C>> {
    const attempts = Math.max(1, Math.floor(this.options.connectAttempts ?? 1))
    for (let attempt = 1; ; attempt++) {
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
    const deadRoots = this.roots.filter((root) => root.dead)
    for (const stale of deadRoots.slice(0, Math.max(0, deadRoots.length - 8))) {
      this.roots.splice(this.roots.indexOf(stale), 1)
      for (const [id, owner] of this.handles) if (owner === stale) this.handles.delete(id)
    }
    const opened = await entry.pending.catch(() => undefined)
    await opened?.close().catch(() => {})
  }
}
