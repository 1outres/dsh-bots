/**
 * The slice of the Incus REST API (https://linuxcontainers.org/incus/docs/main/rest-api/)
 * this package needs. The transport (src/node/incus-transport.ts: the Unix
 * socket, or HTTPS with a pinned server certificate) is injected, so this
 * module only shapes requests and reads the response envelopes. Every request
 * of a project's resources names the project.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/** One raw HTTP exchange with the Incus daemon. */
export interface IncusResponse {
  readonly status: number
  readonly body: unknown
}

/** A bidirectional byte stream (one websocket of an Incus operation). */
export interface ByteChannel extends AsyncIterable<Uint8Array> {
  /** Resolves once the transport took the bytes (backpressure). */
  write(data: Uint8Array): Promise<void>
  /** Close the sending side: the peer reads end of file. Reading continues. */
  end(): Promise<void>
  /** Tear both directions down now. */
  destroy(error?: Error): void
}

export interface IncusTransport {
  json(
    method: HttpMethod,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<IncusResponse>
  upload(
    path: string,
    body: AsyncIterable<Uint8Array>,
    headers: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<IncusResponse>
  websocket(path: string, signal?: AbortSignal): Promise<ByteChannel>
}

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

/** `GET /1.0`: who the server takes this client for, and what it runs. */
export interface IncusServer {
  readonly auth: "trusted" | "untrusted"
  readonly apiExtensions: readonly string[]
  /** e.g. "6.0.4"; empty for an untrusted client. */
  readonly serverVersion: string
  /** Instance drivers, e.g. ["lxc", "qemu"]; empty for an untrusted client. */
  readonly drivers: readonly string[]
}

/** A custom storage volume of the project. */
export interface IncusVolume {
  readonly name: string
  /** "block" or "filesystem". */
  readonly contentType: string
  readonly config: Readonly<Record<string, string>>
  /** Instances and profiles using it, as API paths. */
  readonly usedBy: readonly string[]
}

export interface VolumeSpec {
  readonly pool: string
  readonly name: string
  readonly contentType: "block" | "filesystem"
  readonly description?: string
  /** `size` and `user.*` keys. */
  readonly config: Readonly<Record<string, string>>
}

export interface IncusImage {
  readonly fingerprint: string
  readonly size: number
  readonly aliases: readonly string[]
}

/** A command run in an instance (`POST /1.0/instances/<name>/exec`, non-interactive). */
export interface ExecRequest {
  readonly command: readonly string[]
  readonly user: number
  readonly group: number
  readonly environment: Readonly<Record<string, string>>
  readonly cwd?: string
}

/** A running command's standard streams. */
export interface ExecSession {
  /** Its stdin: `end()` is end of file. */
  readonly stdin: ByteChannel
  readonly stdout: ByteChannel
  readonly stderr: ByteChannel
  /** Send a signal to the command. */
  signal(signal: number): Promise<void>
  /** The exit code, once the command ended (waits at most the operation deadline). */
  exitCode(signal?: AbortSignal): Promise<number>
  /** Close every stream now. */
  destroy(): void
}

export interface IncusClient {
  /** The server, as this client's credentials see it. */
  server(signal?: AbortSignal): Promise<IncusServer>
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
  /** Stop (forcibly) and delete the instance. Resolves when it is gone, also when it never existed. */
  destroy(name: string, signal?: AbortSignal): Promise<void>
  /** Run a command in a running instance, its streams connected. */
  exec(name: string, request: ExecRequest, signal?: AbortSignal): Promise<ExecSession>
  /** The server machine's CPUs and memory. */
  hostResources(signal?: AbortSignal): Promise<IncusHostResources>
  /** The project's own config (`limits.memory`, `user.dsh-bots.pool`, …). */
  projectConfig(signal?: AbortSignal): Promise<Readonly<Record<string, string>>>
  /** A profile of the project, or undefined when it does not exist. */
  profile(name: string, signal?: AbortSignal): Promise<IncusProfile | undefined>
  /** Every profile of the project. */
  profiles(signal?: AbortSignal): Promise<readonly IncusProfile[]>
  /** Whether the project may use the network (it lists only the allowed ones). */
  hasNetwork(name: string, signal?: AbortSignal): Promise<boolean>
  /** A storage pool's total space in bytes. */
  poolSpace(pool: string, signal?: AbortSignal): Promise<number>
  /** A custom volume, or undefined when it does not exist. */
  volume(pool: string, name: string, signal?: AbortSignal): Promise<IncusVolume | undefined>
  /** Every custom volume of the project on the pool. */
  volumes(pool: string, signal?: AbortSignal): Promise<readonly IncusVolume[]>
  createVolume(spec: VolumeSpec, signal?: AbortSignal): Promise<void>
  /** Set config keys of a custom volume (`size`, `user.*`); an empty `user.*` value clears it. */
  patchVolume(
    pool: string,
    name: string,
    config: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<void>
  /** Delete a custom volume. Resolves also when it never existed. */
  deleteVolume(pool: string, name: string, signal?: AbortSignal): Promise<void>
  /** Import a unified image tarball; resolves with its fingerprint. */
  importImage(body: AsyncIterable<Uint8Array>, signal?: AbortSignal): Promise<string>
  image(fingerprint: string, signal?: AbortSignal): Promise<IncusImage | undefined>
  deleteImage(fingerprint: string, signal?: AbortSignal): Promise<void>
  /** The fingerprint an alias points to, or undefined. */
  alias(name: string, signal?: AbortSignal): Promise<string | undefined>
  /** Point an alias at an image, creating it when missing. */
  setAlias(name: string, fingerprint: string, signal?: AbortSignal): Promise<void>
  deleteAlias(name: string, signal?: AbortSignal): Promise<void>
  /** Add this client's certificate to the server's trust store with a trust token. */
  trustWithToken(token: string, signal?: AbortSignal): Promise<void>
}

export interface IncusClientOptions {
  readonly transport: IncusTransport
  /** Incus project of every project-scoped request. */
  readonly project: string
  /** Deadline for one asynchronous operation (create, start, stop, delete, import). */
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

function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function stringsOf(value: unknown): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(recordOf(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  )
}

const isNotFound = (error: unknown) => error instanceof IncusError && error.status === 404

/** Whether a request concerns the server rather than one project's resources. */
const UNSCOPED = /^\/1\.0(\/certificates(\/|$)|$)/

export function createIncusClient(options: IncusClientOptions): IncusClient {
  const { transport, project, operationTimeoutMs, requestTimeoutMs } = options
  const scoped = (path: string): string => {
    if (UNSCOPED.test(path.split("?")[0] as string)) return path
    return `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(project)}`
  }
  const instancePath = (name: string) => `/1.0/instances/${encodeURIComponent(name)}`
  const poolPath = (pool: string) => `/1.0/storage-pools/${encodeURIComponent(pool)}`
  const volumePath = (pool: string, name: string) =>
    `${poolPath(pool)}/volumes/custom/${encodeURIComponent(name)}`

  function bounded(signal: AbortSignal | undefined, ms: number) {
    const deadline = AbortSignal.timeout(ms)
    return {
      deadline,
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    }
  }

  function checked(method: string, path: string, response: IncusResponse): Envelope {
    const envelope = envelopeOf(response.body)
    if (response.status >= 400 || envelope.type === "error") {
      const status = envelope.error_code ?? response.status
      throw new IncusError(
        `Incus ${method} ${path} failed (${status}): ${envelope.error ?? "no error message"}`,
        status,
      )
    }
    return envelope
  }

  async function call(
    method: HttpMethod,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    extraMs = 0,
  ): Promise<Envelope> {
    const limit = bounded(signal, requestTimeoutMs + extraMs)
    let response: IncusResponse
    try {
      response = await transport.json(method, scoped(path), body, limit.signal)
    } catch (error) {
      if (limit.deadline.aborted && !signal?.aborted) {
        throw new Error(
          `Incus ${method} ${path} did not answer within ${requestTimeoutMs + extraMs} ms`,
        )
      }
      throw error
    }
    return checked(method, path, response)
  }

  async function get(path: string, signal?: AbortSignal): Promise<unknown> {
    return (await call("GET", path, undefined, signal)).metadata
  }

  async function getOptional(path: string, signal?: AbortSignal): Promise<unknown> {
    try {
      return await get(path, signal)
    } catch (error) {
      if (isNotFound(error)) return undefined
      throw error
    }
  }

  /** Follow an async response's operation to its end; resolves with the operation's metadata. */
  async function wait(
    what: string,
    envelope: Envelope,
    signal: AbortSignal | undefined,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (envelope.type !== "async") return {}
    const operation = envelope.operation
    if (operation === undefined) throw new Error(`Incus ${what}: async response without operation`)
    let remainingMs = operationTimeoutMs
    // The wait endpoint takes whole seconds and may return while still running.
    while (remainingMs > 0) {
      signal?.throwIfAborted()
      const seconds = Math.max(1, Math.min(30, Math.ceil(remainingMs / 1000)))
      let waited: Envelope
      try {
        waited = await call(
          "GET",
          `${operation}/wait?timeout=${seconds}`,
          undefined,
          signal,
          seconds * 1000,
        )
      } catch (error) {
        // Incus answers a wait that timed out on a running operation with an error.
        if (error instanceof IncusError && /deadline exceeded/i.test(error.message)) {
          remainingMs -= seconds * 1000
          continue
        }
        throw error
      }
      const metadata = recordOf(waited.metadata)
      if (metadata.status === "Success") return recordOf(metadata.metadata)
      if (metadata.status === "Failure" || metadata.status === "Cancelled") {
        throw new Error(`Incus ${what} failed: ${String(metadata.err ?? metadata.status)}`)
      }
      remainingMs -= seconds * 1000
    }
    throw new Error(`Incus ${what} did not finish within ${operationTimeoutMs} ms`)
  }

  async function run(
    what: string,
    method: HttpMethod,
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<Readonly<Record<string, unknown>>> {
    return wait(what, await call(method, path, body, signal), signal)
  }

  async function instance(name: string, signal?: AbortSignal) {
    return (await getOptional(instancePath(name), signal)) as IncusInstance | undefined
  }

  const numberAt = (value: unknown, path: readonly string[], what: string): number => {
    let at: unknown = value
    for (const key of path) at = recordOf(at)[key]
    if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) {
      throw new Error(`Incus did not report ${what}`)
    }
    return at
  }

  async function setState(name: string, action: StateAction, signal?: AbortSignal) {
    const body = action === "stop" ? { action, force: true } : { action }
    await run(`${action} ${name}`, "PUT", `${instancePath(name)}/state`, body, signal)
  }

  const volumeOf = (value: unknown): IncusVolume => {
    const raw = recordOf(value)
    return {
      name: String(raw.name ?? ""),
      contentType: String(raw.content_type ?? ""),
      config: stringsOf(raw.config),
      usedBy: Array.isArray(raw.used_by) ? raw.used_by.map(String) : [],
    }
  }

  async function exec(
    name: string,
    request: ExecRequest,
    signal?: AbortSignal,
  ): Promise<ExecSession> {
    const envelope = await call(
      "POST",
      `${instancePath(name)}/exec`,
      {
        command: request.command,
        environment: request.environment,
        "wait-for-websocket": true,
        interactive: false,
        "record-output": false,
        user: request.user,
        group: request.group,
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      },
      signal,
    )
    const operation = envelope.operation
    const fds = recordOf(recordOf(recordOf(envelope.metadata).metadata).fds)
    const secret = (fd: string) => {
      const value = fds[fd]
      if (typeof value !== "string")
        throw new Error(`Incus exec in ${name}: no websocket for fd ${fd}`)
      return value
    }
    if (operation === undefined) throw new Error(`Incus exec in ${name}: no operation`)
    const socketOf = (fd: string) =>
      transport.websocket(
        scoped(`${operation}/websocket?secret=${encodeURIComponent(secret(fd))}`),
        signal,
      )
    const opened = await Promise.allSettled(["control", "0", "1", "2"].map(socketOf))
    const channels = opened.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    )
    const failed = opened.find((result) => result.status === "rejected")
    if (failed !== undefined) {
      for (const channel of channels) channel.destroy()
      throw failed.reason
    }
    const [control, stdin, stdout, stderr] = channels as [
      ByteChannel,
      ByteChannel,
      ByteChannel,
      ByteChannel,
    ]
    void (async () => {
      for await (const _ of control) {
        // Incus sends nothing the client needs on the control socket.
      }
    })().catch(() => {})
    return {
      stdin,
      stdout,
      stderr,
      signal: (number) =>
        control.write(
          new TextEncoder().encode(JSON.stringify({ command: "signal", signal: number })),
        ),
      async exitCode(waitSignal) {
        const metadata = await wait(`exec in ${name}`, envelope, waitSignal)
        const code = metadata.return
        if (typeof code !== "number") throw new Error(`Incus exec in ${name} reported no exit code`)
        return code
      },
      destroy() {
        for (const channel of channels) channel.destroy()
      },
    }
  }

  const aliasPath = (name: string) => `/1.0/images/aliases/${encodeURIComponent(name)}`

  return {
    async server(signal) {
      const raw = recordOf(await get("/1.0", signal))
      const environment = recordOf(raw.environment)
      const driver = typeof environment.driver === "string" ? environment.driver : ""
      return {
        auth: raw.auth === "trusted" ? "trusted" : "untrusted",
        apiExtensions: Array.isArray(raw.api_extensions) ? raw.api_extensions.map(String) : [],
        serverVersion:
          typeof environment.server_version === "string" ? environment.server_version : "",
        drivers: driver
          .split("|")
          .map((part) => part.trim())
          .filter((part) => part !== ""),
      }
    },
    instance,
    async instances(signal) {
      const metadata = await get("/1.0/instances?recursion=1", signal)
      return Array.isArray(metadata) ? (metadata as IncusInstance[]) : []
    },
    async create(spec, signal) {
      const envelope = await call(
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
      await run(`configure ${name}`, "PATCH", instancePath(name), { config }, signal)
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
      await run(
        `configure ${name}`,
        "PUT",
        instancePath(name),
        {
          architecture,
          description,
          ephemeral,
          stateful,
          profiles,
          config: { ...current.config, ...change.config },
          devices: { ...current.devices, ...change.devices },
        },
        signal,
      )
    },
    setState,
    async destroy(name, signal) {
      const current = await instance(name, signal)
      if (current === undefined) return
      if (current.status !== "Stopped") await setState(name, "stop", signal)
      try {
        await run(`delete ${name}`, "DELETE", instancePath(name), undefined, signal)
      } catch (error) {
        if (isNotFound(error)) return
        throw error
      }
    },
    exec,
    async hostResources(signal) {
      const metadata = await get("/1.0/resources", signal)
      return {
        cpus: numberAt(metadata, ["cpu", "total"], "the host's CPU count"),
        memoryBytes: numberAt(metadata, ["memory", "total"], "the host's memory"),
      }
    },
    async projectConfig(signal) {
      return stringsOf(
        recordOf(await get(`/1.0/projects/${encodeURIComponent(project)}`, signal)).config,
      )
    },
    async profile(name, signal) {
      return (await getOptional(`/1.0/profiles/${encodeURIComponent(name)}`, signal)) as
        | IncusProfile
        | undefined
    },
    async profiles(signal) {
      const metadata = await get("/1.0/profiles?recursion=1", signal)
      return Array.isArray(metadata) ? (metadata as IncusProfile[]) : []
    },
    async hasNetwork(name, signal) {
      return (await getOptional(`/1.0/networks/${encodeURIComponent(name)}`, signal)) !== undefined
    },
    async poolSpace(pool, signal) {
      return numberAt(
        await get(`${poolPath(pool)}/resources`, signal),
        ["space", "total"],
        `the size of storage pool "${pool}"`,
      )
    },
    async volume(pool, name, signal) {
      const metadata = await getOptional(volumePath(pool, name), signal)
      return metadata === undefined ? undefined : volumeOf(metadata)
    },
    async volumes(pool, signal) {
      const metadata = await get(`${poolPath(pool)}/volumes/custom?recursion=1`, signal)
      return Array.isArray(metadata) ? metadata.map(volumeOf) : []
    },
    async createVolume(spec, signal) {
      await run(
        `create volume ${spec.name}`,
        "POST",
        `${poolPath(spec.pool)}/volumes/custom`,
        {
          name: spec.name,
          type: "custom",
          content_type: spec.contentType,
          description: spec.description ?? "",
          config: spec.config,
        },
        signal,
      )
    },
    async patchVolume(pool, name, config, signal) {
      await run(`configure volume ${name}`, "PATCH", volumePath(pool, name), { config }, signal)
    },
    async deleteVolume(pool, name, signal) {
      try {
        await run(`delete volume ${name}`, "DELETE", volumePath(pool, name), undefined, signal)
      } catch (error) {
        if (isNotFound(error)) return
        throw error
      }
    },
    async importImage(body, signal) {
      const limit = bounded(signal, operationTimeoutMs)
      const response = await transport.upload(
        scoped("/1.0/images"),
        body,
        { "Content-Type": "application/octet-stream" },
        limit.signal,
      )
      const metadata = await wait("image import", checked("POST", "/1.0/images", response), signal)
      const fingerprint = metadata.fingerprint
      if (typeof fingerprint !== "string")
        throw new Error("Incus image import reported no fingerprint")
      return fingerprint
    },
    async image(fingerprint, signal) {
      const raw = await getOptional(`/1.0/images/${encodeURIComponent(fingerprint)}`, signal)
      if (raw === undefined) return undefined
      const image = recordOf(raw)
      return {
        fingerprint: String(image.fingerprint ?? ""),
        size: typeof image.size === "number" ? image.size : 0,
        aliases: Array.isArray(image.aliases)
          ? image.aliases.map((alias) => String(recordOf(alias).name))
          : [],
      }
    },
    async deleteImage(fingerprint, signal) {
      await run(
        `delete image ${fingerprint}`,
        "DELETE",
        `/1.0/images/${encodeURIComponent(fingerprint)}`,
        undefined,
        signal,
      )
    },
    async alias(name, signal) {
      const raw = await getOptional(aliasPath(name), signal)
      if (raw === undefined) return undefined
      const target = recordOf(raw).target
      return typeof target === "string" ? target : undefined
    },
    async setAlias(name, fingerprint, signal) {
      const current = await getOptional(aliasPath(name), signal)
      if (current === undefined) {
        await call(
          "POST",
          "/1.0/images/aliases",
          { name, target: fingerprint, description: "" },
          signal,
        )
      } else {
        await call("PATCH", aliasPath(name), { target: fingerprint }, signal)
      }
    },
    async deleteAlias(name, signal) {
      try {
        await call("DELETE", aliasPath(name), undefined, signal)
      } catch (error) {
        if (isNotFound(error)) return
        throw error
      }
    },
    async trustWithToken(token, signal) {
      await call("POST", "/1.0/certificates", { type: "client", trust_token: token }, signal)
    },
  }
}
