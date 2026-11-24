/**
 * The slice of the Incus REST API (https://linuxcontainers.org/incus/docs/main/rest-api/)
 * this package needs. The transport (HTTP over the Unix socket) is injected,
 * so this module only shapes requests and reads the response envelopes.
 */

/** One raw HTTP exchange with the Incus daemon. */
export interface IncusResponse {
  readonly status: number
  readonly body: unknown
}

export type IncusTransport = (
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) => Promise<IncusResponse>

export type IncusDevice = Readonly<Record<string, string>>

export interface IncusInstance {
  readonly name: string
  readonly description?: string
  readonly architecture?: string
  readonly ephemeral?: boolean
  readonly stateful?: boolean
  readonly profiles?: readonly string[]
  /** "Running", "Stopped", "Frozen", "Error", ... */
  readonly status: string
  readonly config: Readonly<Record<string, string>>
  /** The config with its profiles' applied. */
  readonly expanded_config?: Readonly<Record<string, string>>
  readonly devices: Readonly<Record<string, IncusDevice>>
  readonly expanded_devices?: Readonly<Record<string, IncusDevice>>
}

export interface InstanceSpec {
  readonly name: string
  readonly description?: string
  readonly image: string
  readonly profiles: readonly string[]
  readonly config: Readonly<Record<string, string>>
  readonly devices: Readonly<Record<string, IncusDevice>>
  readonly start: boolean
}

/** A change of an instance's own config and devices. */
export interface InstanceUpdate {
  /** Config keys to set. */
  readonly config?: Readonly<Record<string, string>>
  /** Devices to set; one named here replaces the instance's own device of that name. */
  readonly devices?: Readonly<Record<string, IncusDevice>>
}

export type StateAction = "start" | "stop" | "unfreeze"

/** What the Incus server's machine has (`GET /1.0/resources`). */
export interface IncusHostResources {
  /** Logical CPUs (threads). */
  readonly cpus: number
  readonly memoryBytes: number
}

export interface IncusProfile {
  readonly name: string
  readonly devices: Readonly<Record<string, IncusDevice>>
}

export interface IncusClient {
  /** The instance, or `undefined` when it does not exist. */
  instance(name: string, signal?: AbortSignal): Promise<IncusInstance | undefined>
  /** Every instance of the project, with its config. */
  instances(signal?: AbortSignal): Promise<readonly IncusInstance[]>
  /**
   * Create a virtual machine from an image alias; resolves when the operation
   * finished. Once Incus accepted the request, an abort still waits for the
   * operation to end (bounded by the operation deadline), then rejects, so
   * no half-created instance is left behind unobserved.
   */
  create(spec: InstanceSpec, signal?: AbortSignal): Promise<void>
  /** Set `user.*` config keys of an instance; an empty value clears a key. */
  patchConfig(
    name: string,
    config: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<void>
  /**
   * Change an instance's own config and devices: read it, apply the change
   * and write it back whole (PUT). PATCH cannot remove a key: an empty value
   * stays in the instance's config, hides the profiles' value and fails the
   * project's limits check ("has no limits.memory config"). The caller
   * serializes changes of one instance.
   */
  update(name: string, change: InstanceUpdate, signal?: AbortSignal): Promise<void>
  setState(name: string, action: StateAction, signal?: AbortSignal): Promise<void>
  /** The server machine's CPUs and memory. */
  hostResources(signal?: AbortSignal): Promise<IncusHostResources>
  /** The project's own config (`limits.memory`, …). */
  projectConfig(signal?: AbortSignal): Promise<Readonly<Record<string, string>>>
  /** A profile of the project, or undefined when it does not exist. */
  profile(name: string, signal?: AbortSignal): Promise<IncusProfile | undefined>
  /** A storage pool's total space in bytes. */
  poolSpace(pool: string, signal?: AbortSignal): Promise<number>
  /** Stop (forcibly) and delete the instance. Resolves when it is gone, also when it never existed. */
  destroy(name: string, signal?: AbortSignal): Promise<void>
}

export interface IncusClientOptions {
  readonly transport: IncusTransport
  /** Incus project; "default" adds no query parameter. */
  readonly project: string
  /** Deadline for one asynchronous operation (create, start, stop, delete). */
  readonly operationTimeoutMs: number
  /** Deadline for one HTTP exchange; a long-poll wait gets its own wait time on top. */
  readonly requestTimeoutMs: number
}

interface Envelope {
  readonly type?: string
  readonly error?: string
  readonly error_code?: number
  readonly operation?: string
  readonly metadata?: unknown
}

export class IncusError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "IncusError"
  }
}

function envelopeOf(body: unknown): Envelope {
  return typeof body === "object" && body !== null ? (body as Envelope) : {}
}

export function createIncusClient(options: IncusClientOptions): IncusClient {
  const { transport, project, operationTimeoutMs, requestTimeoutMs } = options
  const withProject = (path: string): string => {
    if (project === "default") return path
    return `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`
  }
  const instancePath = (name: string) => `/1.0/instances/${encodeURIComponent(name)}`

  async function call(
    method: Parameters<IncusTransport>[0],
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    extraMs = 0,
  ): Promise<{ status: number; envelope: Envelope }> {
    const deadline = AbortSignal.timeout(requestTimeoutMs + extraMs)
    const bounded = signal === undefined ? deadline : AbortSignal.any([signal, deadline])
    let response: IncusResponse
    try {
      response = await transport(method, withProject(path), body, bounded)
    } catch (error) {
      if (deadline.aborted && !signal?.aborted) {
        throw new Error(
          `Incus ${method} ${path} did not answer within ${requestTimeoutMs + extraMs} ms`,
        )
      }
      throw error
    }
    const envelope = envelopeOf(response.body)
    if (response.status >= 400 || envelope.type === "error") {
      const status = envelope.error_code ?? response.status
      throw new IncusError(
        `Incus ${method} ${path} failed (${status}): ${envelope.error ?? "no error message"}`,
        status,
      )
    }
    return { status: response.status, envelope }
  }

  async function wait(
    what: string,
    envelope: Envelope,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    if (envelope.type !== "async") return
    const operation = envelope.operation
    if (operation === undefined) throw new Error(`Incus ${what}: async response without operation`)
    let remainingMs = operationTimeoutMs
    // The wait endpoint takes whole seconds and may return while still running.
    while (remainingMs > 0) {
      signal?.throwIfAborted()
      const seconds = Math.max(1, Math.min(30, Math.ceil(remainingMs / 1000)))
      let waited: Envelope
      try {
        ;({ envelope: waited } = await call(
          "GET",
          `${operation}/wait?timeout=${seconds}`,
          undefined,
          signal,
          seconds * 1000,
        ))
      } catch (error) {
        // Incus answers a wait that timed out on a running operation with an error.
        if (error instanceof IncusError && /deadline exceeded/i.test(error.message)) {
          remainingMs -= seconds * 1000
          continue
        }
        throw error
      }
      const metadata = envelopeOf(waited.metadata) as { status?: string; err?: string }
      if (metadata.status === "Success") return
      if (metadata.status === "Failure" || metadata.status === "Cancelled") {
        throw new Error(`Incus ${what} failed: ${metadata.err ?? metadata.status}`)
      }
      remainingMs -= seconds * 1000
    }
    throw new Error(`Incus ${what} did not finish within ${operationTimeoutMs} ms`)
  }

  async function instance(name: string, signal?: AbortSignal) {
    try {
      const { envelope } = await call("GET", instancePath(name), undefined, signal)
      return envelope.metadata as IncusInstance
    } catch (error) {
      if (error instanceof IncusError && error.status === 404) return undefined
      throw error
    }
  }

  const numberAt = (value: unknown, path: readonly string[], what: string): number => {
    let at: unknown = value
    for (const key of path)
      at = typeof at === "object" && at !== null ? (at as Record<string, unknown>)[key] : undefined
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) {
      throw new Error(`Incus did not report ${what}`)
    }
    return at
  }

  async function setState(name: string, action: StateAction, signal?: AbortSignal) {
    const body = action === "stop" ? { action, force: true } : { action }
    const { envelope } = await call("PUT", `${instancePath(name)}/state`, body, signal)
    await wait(`${action} ${name}`, envelope, signal)
  }

  return {
    instance,
    async instances(signal) {
      const { envelope } = await call("GET", "/1.0/instances?recursion=1", undefined, signal)
      return Array.isArray(envelope.metadata) ? (envelope.metadata as IncusInstance[]) : []
    },
    async create(spec, signal) {
      const { envelope } = await call(
        "POST",
        "/1.0/instances",
        {
          name: spec.name,
          description: spec.description ?? "",
          type: "virtual-machine",
          source: { type: "image", alias: spec.image },
          profiles: spec.profiles,
          config: spec.config,
          devices: spec.devices,
          start: spec.start,
        },
        signal,
      )
      // Accepted: follow the operation to its end even when aborted meanwhile.
      await wait(`create ${spec.name}`, envelope, undefined)
      signal?.throwIfAborted()
    },
    async patchConfig(name, config, signal) {
      const { envelope } = await call("PATCH", instancePath(name), { config }, signal)
      await wait(`configure ${name}`, envelope, signal)
    },
    async update(name, change, signal) {
      const current = await instance(name, signal)
      if (current === undefined) throw new Error(`Incus instance "${name}" disappeared`)
      const { architecture, description, ephemeral, stateful, profiles } = current
      if (
        architecture === undefined ||
        description === undefined ||
        ephemeral === undefined ||
        stateful === undefined ||
        profiles === undefined
      ) {
        throw new Error(
          `Incus GET ${instancePath(name)} did not return the instance's writable fields`,
        )
      }
      const config: Record<string, string> = { ...current.config, ...change.config }
      const { envelope } = await call(
        "PUT",
        instancePath(name),
        {
          architecture,
          description,
          ephemeral,
          stateful,
          profiles,
          config,
          devices: { ...current.devices, ...change.devices },
        },
        signal,
      )
      await wait(`configure ${name}`, envelope, signal)
    },
    setState,
    async hostResources(signal) {
      const { envelope } = await call("GET", "/1.0/resources", undefined, signal)
      return {
        cpus: numberAt(envelope.metadata, ["cpu", "total"], "the host's CPU count"),
        memoryBytes: numberAt(envelope.metadata, ["memory", "total"], "the host's memory"),
      }
    },
    async projectConfig(signal) {
      const { envelope } = await call(
        "GET",
        `/1.0/projects/${encodeURIComponent(project)}`,
        undefined,
        signal,
      )
      const config = (envelopeOf(envelope.metadata) as { config?: unknown }).config
      return typeof config === "object" && config !== null ? (config as Record<string, string>) : {}
    },
    async profile(name, signal) {
      try {
        const { envelope } = await call(
          "GET",
          `/1.0/profiles/${encodeURIComponent(name)}`,
          undefined,
          signal,
        )
        return envelope.metadata as IncusProfile
      } catch (error) {
        if (error instanceof IncusError && error.status === 404) return undefined
        throw error
      }
    },
    async poolSpace(pool, signal) {
      const { envelope } = await call(
        "GET",
        `/1.0/storage-pools/${encodeURIComponent(pool)}/resources`,
        undefined,
        signal,
      )
      return numberAt(envelope.metadata, ["space", "total"], `the size of storage pool "${pool}"`)
    },
    async destroy(name, signal) {
      const current = await instance(name, signal)
      if (current === undefined) return
      if (current.status !== "Stopped") await setState(name, "stop", signal)
      try {
        const { envelope } = await call("DELETE", instancePath(name), undefined, signal)
        await wait(`delete ${name}`, envelope, signal)
      } catch (error) {
        if (error instanceof IncusError && error.status === 404) return
        throw error
      }
    },
  }
}
