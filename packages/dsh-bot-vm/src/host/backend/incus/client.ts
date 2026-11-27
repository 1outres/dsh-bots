export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

export interface IncusResponse {
  readonly status: number
  readonly body: unknown
}

export interface ByteChannel extends AsyncIterable<Uint8Array> {
  write(data: Uint8Array): Promise<void>
  end(): Promise<void>
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
  readonly status: string
  readonly config: Readonly<Record<string, string>>
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

export interface InstanceUpdate {
  readonly config?: Readonly<Record<string, string>>
  readonly devices?: Readonly<Record<string, IncusDevice>>
}

export type StateAction = "start" | "stop" | "unfreeze"

export interface IncusHostResources {
  readonly cpus: number
  readonly memoryBytes: number
}

export interface IncusQuota {
  readonly limit: number | undefined
  readonly usage: number
}

export type IncusProjectState = Readonly<Record<string, IncusQuota>>

export interface IncusProfile {
  readonly name: string
  readonly devices: Readonly<Record<string, IncusDevice>>
}

export interface IncusServer {
  readonly auth: "trusted" | "untrusted"
  readonly apiExtensions: readonly string[]
  readonly serverVersion: string
  readonly drivers: readonly string[]
}

export interface IncusVolume {
  readonly name: string
  readonly contentType: string
  readonly config: Readonly<Record<string, string>>
  readonly usedBy: readonly string[]
}

export interface VolumeSpec {
  readonly pool: string
  readonly name: string
  readonly contentType: "block" | "filesystem"
  readonly description?: string
  readonly config: Readonly<Record<string, string>>
}

export interface ImageUpload {
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

export interface IncusImage {
  readonly fingerprint: string
  readonly size: number
  readonly aliases: readonly string[]
}

export interface ExecRequest {
  readonly command: readonly string[]
  readonly user: number
  readonly group: number
  readonly environment: Readonly<Record<string, string>>
  readonly cwd?: string
}

export interface ExecSession {
  readonly stdin: ByteChannel
  readonly stdout: ByteChannel
  readonly stderr: ByteChannel
  signal(signal: number): Promise<void>
  exitCode(signal?: AbortSignal): Promise<number>
  destroy(): void
}

export interface IncusClient {
  server(signal?: AbortSignal): Promise<IncusServer>
  instance(name: string, signal?: AbortSignal): Promise<IncusInstance | undefined>
  instances(signal?: AbortSignal): Promise<readonly IncusInstance[]>
  create(spec: InstanceSpec, signal?: AbortSignal): Promise<void>
  patchConfig(
    name: string,
    config: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<void>
  update(name: string, change: InstanceUpdate, signal?: AbortSignal): Promise<void>
  setState(name: string, action: StateAction, signal?: AbortSignal): Promise<void>
  destroy(name: string, signal?: AbortSignal): Promise<void>
  exec(name: string, request: ExecRequest, signal?: AbortSignal): Promise<ExecSession>
  hostResources(signal?: AbortSignal): Promise<IncusHostResources>
  projectConfig(signal?: AbortSignal): Promise<Readonly<Record<string, string>>>
  projectState(signal?: AbortSignal): Promise<IncusProjectState>
  profile(name: string, signal?: AbortSignal): Promise<IncusProfile | undefined>
  profiles(signal?: AbortSignal): Promise<readonly IncusProfile[]>
  hasNetwork(name: string, signal?: AbortSignal): Promise<boolean>
  poolSpace(pool: string, signal?: AbortSignal): Promise<number>
  volume(pool: string, name: string, signal?: AbortSignal): Promise<IncusVolume | undefined>
  volumes(pool: string, signal?: AbortSignal): Promise<readonly IncusVolume[]>
  createVolume(spec: VolumeSpec, signal?: AbortSignal): Promise<void>
  patchVolume(
    pool: string,
    name: string,
    config: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<void>
  deleteVolume(pool: string, name: string, signal?: AbortSignal): Promise<void>
  importImage(body: AsyncIterable<Uint8Array>, options: ImageUpload): Promise<string>
  image(fingerprint: string, signal?: AbortSignal): Promise<IncusImage | undefined>
  deleteImage(fingerprint: string, signal?: AbortSignal): Promise<void>
  alias(name: string, signal?: AbortSignal): Promise<string | undefined>
  setAlias(name: string, fingerprint: string, signal?: AbortSignal): Promise<void>
  deleteAlias(name: string, signal?: AbortSignal): Promise<void>
  trustWithToken(token: string, signal?: AbortSignal): Promise<void>
}

export interface IncusClientOptions {
  readonly transport: IncusTransport
  readonly project: string
  readonly operationTimeoutMs: number
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

  async function wait(
    what: string,
    envelope: Envelope,
    signal: AbortSignal | undefined,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (envelope.type !== "async") return {}
    const operation = envelope.operation
    if (operation === undefined) throw new Error(`Incus ${what}: async response without operation`)
    let remainingMs = operationTimeoutMs
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
    async projectState(signal) {
      const path = `/1.0/projects/${encodeURIComponent(project)}/state`
      const resources = recordOf(recordOf(await get(path, signal)).resources)
      return Object.fromEntries(
        Object.entries(resources).map(([resource, value]) => {
          const { Limit: limit, Usage: usage } = recordOf(value)
          if (
            typeof limit !== "number" ||
            !Number.isSafeInteger(limit) ||
            limit < -1 ||
            typeof usage !== "number" ||
            !Number.isSafeInteger(usage) ||
            usage < 0
          ) {
            throw new Error(`Incus GET ${path} did not report the limit and usage of ${resource}`)
          }
          return [resource, { limit: limit === -1 ? undefined : limit, usage }]
        }),
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
    async importImage(body, { timeoutMs, signal }) {
      const limit = bounded(signal, timeoutMs)
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
