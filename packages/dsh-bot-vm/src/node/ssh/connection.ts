import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { createConnection, type Socket } from "node:net"
import { join } from "node:path"
import { SSH_PROTOCOL_VERSION, SshRpcPeer } from "@deepseek-ai/dsh-ssh/protocol"
import { helloSchema, type SshStreamEndpoint } from "@deepseek-ai/dsh-ssh/schemas"
import { z } from "zod"
import { authenticateStream } from "./stream-security"

export type Hello = z.infer<typeof helloSchema>

export interface ResultSchema<T> {
  parse(value: unknown): T
}

interface RpcPeer {
  request<T>(
    method: string,
    params: unknown,
    schema: ResultSchema<T>,
    signal?: AbortSignal,
  ): Promise<T>
  close(error?: Error): void
  once(event: "closed", listener: (error: unknown) => void): unknown
}

const nullResult: ResultSchema<null> = {
  parse(value) {
    if (value !== null) throw new Error("SSH helper returned a value where none was expected")
    return null
  },
}

export type HelperLaunch =
  | {
      kind: "node-script"
      node: string
      bootstrapPath?: string
      bootstrapHash?: string
    }
  | { kind: "executable" }

export interface SshConnectionConfig {
  host: string
  configFile: string
  launch: HelperLaunch
  helper: string
  helperHash: string
  workspace: string
  requestTimeoutMs?: number
  maxFrameBytes?: number
  maxPending?: number
  leaseMs?: number
}

export type PtcLaunch =
  | { kind: "embedded"; executable: string }
  | { kind: "node-script"; executable: string; bootstrapPath: string }

const configSchema = z
  .object({
    host: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@-]*$/),
    configFile: z.string().startsWith("/"),
    launch: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("node-script"),
          node: z.string().startsWith("/"),
          bootstrapPath: z.string().startsWith("/").optional(),
          bootstrapHash: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .optional(),
        })
        .strict()
        .refine(
          (value) => (value.bootstrapPath === undefined) === (value.bootstrapHash === undefined),
          "bootstrapPath and bootstrapHash must be paired",
        ),
      z.object({ kind: z.literal("executable") }).strict(),
    ]),
    helper: z.string().startsWith("/"),
    helperHash: z.string().regex(/^[0-9a-f]{64}$/),
    workspace: z.string().startsWith("/"),
    requestTimeoutMs: z.number().int().positive().max(2_147_483_647),
    maxFrameBytes: z
      .number()
      .int()
      .positive()
      .max(64 * 1024 * 1024),
    maxPending: z.number().int().positive().max(128),
    leaseMs: z.number().int().min(3000).max(600_000),
  })
  .strict()

export const SSH_CONNECTION_DEFAULTS = {
  requestTimeoutMs: 60_000,
  maxFrameBytes: 64 * 1024 * 1024,
  maxPending: 128,
  leaseMs: 30_000,
} as const

export class SshConnection {
  readonly ready: Promise<Hello>
  private rpc: RpcPeer | undefined
  private child: ChildProcessWithoutNullStreams | undefined
  private childClosed: Promise<void> | undefined
  private directory: string | undefined
  private heartbeat: NodeJS.Timeout | undefined
  private closed = false
  private readonly lifetime = new AbortController()
  private readonly operations = new Set<Promise<unknown>>()
  private disposal: Promise<void> | undefined
  private failure: Error | undefined
  private readonly sockets = new Set<Socket>()
  private nextSocket = 0
  private readonly config: Required<SshConnectionConfig>
  private remote: Hello | undefined

  constructor(config: SshConnectionConfig) {
    if (process.platform !== "linux" && process.platform !== "darwin") {
      throw new Error("SSH runtime requires a POSIX client")
    }
    this.config = configSchema.parse({
      ...SSH_CONNECTION_DEFAULTS,
      ...config,
    }) as Required<SshConnectionConfig>
    this.ready = this.start()
    void this.ready.catch((error: unknown) => {
      this.fail(error as Error)
    })
  }

  get failed(): boolean {
    return this.failure !== undefined || this.closed
  }

  get ptcLaunch(): PtcLaunch {
    if (this.remote === undefined) throw new Error("SSH helper is not ready")
    const launch = this.config.launch
    if (launch.kind === "executable")
      return { kind: "embedded", executable: this.remote.executable }
    if (launch.bootstrapPath === undefined) {
      throw new Error("SSH PTC requires a verified bootstrapPath and bootstrapHash")
    }
    return {
      kind: "node-script",
      executable: this.remote.executable,
      bootstrapPath: launch.bootstrapPath,
    }
  }

  async request<T>(
    method: string,
    params: unknown,
    result: ResultSchema<T>,
    signal?: AbortSignal,
    wait = false,
  ): Promise<T> {
    this.assertOpen()
    await this.ready
    this.assertOpen()
    const bounded = wait
      ? signal
      : signal === undefined
        ? AbortSignal.timeout(this.config.requestTimeoutMs)
        : AbortSignal.any([signal, AbortSignal.timeout(this.config.requestTimeoutMs)])
    return (this.rpc as RpcPeer).request(method, params, result, bounded)
  }

  async connectStream(endpoint: SshStreamEndpoint, signal?: AbortSignal): Promise<Socket> {
    return this.track(this.establishStream(endpoint, signal))
  }

  private async establishStream(endpoint: SshStreamEndpoint, given?: AbortSignal): Promise<Socket> {
    const hello = await this.ready
    this.assertOpen()
    const signal =
      given === undefined ? this.lifetime.signal : AbortSignal.any([given, this.lifetime.signal])
    const remote = endpoint.path
    if (!remote.startsWith(`${hello.root}/`) || /[:\r\n\0]/u.test(remote)) {
      throw new Error("SSH helper returned an invalid stream path")
    }
    signal.throwIfAborted()
    const local = join(this.directory as string, `s${this.nextSocket++}`)
    const forward = `${local}:${remote}`
    const cancelForward = async (): Promise<void> => {
      if (!this.closed) await this.controlCommand(["-O", "cancel", "-L", forward]).catch(() => {})
      await rm(local, { force: true })
    }
    try {
      await this.controlCommand(
        ["-O", "forward", "-o", "ExitOnForwardFailure=yes", "-L", forward],
        signal,
      )
    } catch (error) {
      await cancelForward()
      throw error
    }
    signal.throwIfAborted()
    const socket = createConnection({ path: local, allowHalfOpen: true })
    this.sockets.add(socket)
    socket.once("close", () => {
      this.sockets.delete(socket)
      void this.track(cancelForward()).catch(() => {})
    })
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        signal.removeEventListener("abort", aborted)
        socket.off("connect", connected)
        socket.off("error", failed)
        socket.off("close", closed)
      }
      const connected = (): void => {
        cleanup()
        resolve()
      }
      const failed = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const closed = (): void => {
        failed(new Error("SSH connection closed before stream establishment"))
      }
      const aborted = (): void => {
        socket.destroy(
          signal.reason instanceof Error ? signal.reason : new Error(String(signal.reason)),
        )
      }
      socket.once("connect", connected)
      socket.once("error", failed)
      socket.once("close", closed)
      signal.addEventListener("abort", aborted, { once: true })
    })
    const authenticated = await authenticateStream(
      socket,
      endpoint.capability,
      this.config.requestTimeoutMs,
      signal,
    )
    this.sockets.add(authenticated)
    authenticated.on("error", () => {
      authenticated.destroy()
    })
    authenticated.once("close", () => {
      this.sockets.delete(authenticated)
    })
    return authenticated
  }

  dispose(): Promise<void> {
    this.disposal ??= this.disposeOnce()
    return this.disposal
  }

  private async disposeOnce(): Promise<void> {
    this.closed = true
    this.lifetime.abort(new Error("SSH connection is closing"))
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    try {
      await this.ready.catch(() => {})
      if (this.failure === undefined) {
        await this.rpc?.request(
          "close",
          {},
          nullResult,
          AbortSignal.timeout(this.config.requestTimeoutMs),
        )
      }
    } finally {
      this.rpc?.close()
      const socketClosures = [...this.sockets].reverse().map(
        (socket) =>
          new Promise<void>((resolve) => {
            if (socket.closed) resolve()
            else {
              socket.once("close", () => {
                resolve()
              })
              socket.destroy()
            }
          }),
      )
      this.child?.kill("SIGTERM")
      const force = setTimeout(() => {
        this.child?.kill("SIGKILL")
      }, this.config.requestTimeoutMs)
      try {
        await this.childClosed
      } finally {
        clearTimeout(force)
      }
      await Promise.all(socketClosures)
      while (this.operations.size > 0) await Promise.allSettled([...this.operations])
      if (this.directory !== undefined) await rm(this.directory, { recursive: true, force: true })
    }
  }

  private controlPath(): string {
    return join(this.directory as string, "master")
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("SSH connection is closed")
    if (this.failure !== undefined) throw this.failure
  }

  private track<T>(operation: Promise<T>): Promise<T> {
    this.operations.add(operation)
    void operation
      .finally(() => {
        this.operations.delete(operation)
      })
      .catch(() => {})
    return operation
  }

  private async controlCommand(args: string[], signal?: AbortSignal): Promise<void> {
    const signals = [this.lifetime.signal, AbortSignal.timeout(this.config.requestTimeoutMs)]
    if (signal !== undefined) signals.push(signal)
    const combined = AbortSignal.any(signals)
    combined.throwIfAborted()
    let settle: (error: Error | null) => void = () => {}
    const result = new Promise<void>((resolve, reject) => {
      settle = (error) => (error === null ? resolve() : reject(error))
    })
    const command = execFile(
      "ssh",
      ["-F", this.config.configFile, "-S", this.controlPath(), ...args, this.config.host],
      { signal: combined, maxBuffer: 64 * 1024 },
      (error) => settle(error),
    )
    const closed = new Promise<void>((resolve) => {
      command.once("close", () => {
        resolve()
      })
    })
    let force: NodeJS.Timeout | undefined
    const escalate = (): void => {
      force = setTimeout(() => {
        command.kill("SIGKILL")
      }, this.config.requestTimeoutMs)
      force.unref()
    }
    combined.addEventListener("abort", escalate, { once: true })
    try {
      await result
    } finally {
      await closed
      combined.removeEventListener("abort", escalate)
      if (force !== undefined) clearTimeout(force)
    }
  }

  private fail(error: Error): void {
    if (this.failure !== undefined) return
    this.failure = error
    this.lifetime.abort(error)
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.rpc?.close(error)
    for (const socket of [...this.sockets].reverse()) socket.destroy(error)
    this.child?.kill("SIGTERM")
  }

  private async start(): Promise<Hello> {
    this.directory = await mkdtemp("/tmp/dsh-ssh-")
    if (this.closed) throw new Error("SSH connection closed before startup")
    const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`
    const launch = this.config.launch
    const command =
      launch.kind === "node-script"
        ? [launch.node, "--disable-sigusr1", this.config.helper].map(quote).join(" ")
        : `NODE_OPTIONS='--disable-sigusr1' ${quote(this.config.helper)}`
    const bootstrapPath = launch.kind === "node-script" ? launch.bootstrapPath : undefined
    const bootstrapHash = launch.kind === "node-script" ? launch.bootstrapHash : undefined
    const child = spawn(
      "ssh",
      [
        "-F",
        this.config.configFile,
        "-T",
        "-M",
        "-S",
        this.controlPath(),
        "-o",
        "ControlPersist=no",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ServerAliveInterval=10",
        "-o",
        "ServerAliveCountMax=3",
        this.config.host,
        command,
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    )
    this.child = child
    this.childClosed = new Promise((resolve) => {
      child.once("close", () => {
        resolve()
      })
    })
    child.stderr.resume()
    child.once("error", (error) => {
      this.fail(error)
    })
    child.once("close", () => {
      this.fail(new Error("SSH helper disconnected; remote outcomes and cleanup are unknown"))
    })
    const rpc: RpcPeer = new SshRpcPeer(
      child.stdout,
      child.stdin,
      this.config.maxFrameBytes,
      this.config.maxPending,
    )
    this.rpc = rpc
    rpc.once("closed", (error) => {
      this.fail(error as Error)
    })
    const hello = await rpc.request(
      "hello",
      {
        protocol: SSH_PROTOCOL_VERSION,
        workspace: this.config.workspace,
        leaseMs: this.config.leaseMs,
        ...(bootstrapPath === undefined ? {} : { bootstrapPath }),
      },
      helloSchema,
      AbortSignal.timeout(this.config.requestTimeoutMs),
    )
    if (hello.hash !== this.config.helperHash)
      throw new Error("SSH helper digest differs from the configured artifact")
    if (hello.kind !== launch.kind)
      throw new Error("SSH helper runtime differs from the configured launch kind")
    if (hello.bootstrapHash !== bootstrapHash) {
      throw new Error("SSH PTC bootstrap digest differs from the configured artifact")
    }
    this.remote = hello
    let beating = false
    this.heartbeat = setInterval(
      () => {
        if (beating) return
        beating = true
        void rpc
          .request("heartbeat", {}, nullResult, AbortSignal.timeout(this.config.leaseMs / 2))
          .catch((error: unknown) => {
            this.fail(error as Error)
          })
          .finally(() => {
            beating = false
          })
      },
      Math.floor(this.config.leaseMs / 3),
    )
    this.heartbeat.unref()
    return hello
  }
}
