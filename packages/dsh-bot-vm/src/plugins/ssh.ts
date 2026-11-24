/**
 * `@1outres/dsh-bot-vm/ssh`: the `ssh` service of a bot's execution group.
 *
 * Takes `@deepseek-ai/dsh-ssh`'s config and serves the same API
 * (`request`, `connectStream`, `ready`, `ptcLaunch`, `dispose`) that
 * `dsh-fs-ssh` and `dsh-subprocess-ssh` call, over an `SshConnection` it
 * opens lazily and replaces after a failure:
 *
 * - Mounting never connects, so a bot preset mounts while its VM is down;
 *   only the calls fail ("cannot reach the bot VM over SSH ...").
 * - Connecting is tried twice per call (`connectAttempts`): the first helper
 *   start on a VM that just booted can miss dsh-ssh's handshake deadline.
 * - A connection that failed (VM rebooted, network blip, helper exit) is
 *   dropped; the next call opens a new one. Calls in flight at the failure
 *   still fail, as with dsh-ssh: nothing is replayed.
 * - Process and stream handles stay with the connection that issued them: a
 *   call for a handle of a lost connection is answered locally (a release
 *   resolves, anything else fails) instead of reaching the new connection.
 * - `dispose()` (which the SSH providers call when remote cleanup cannot be
 *   confirmed) closes the current connection, and only when the latest failed
 *   call ran on it; the next call reconnects.
 */
import { type Context, Service } from "@deepseek-ai/cordis"
import { SshConnection, type Config as SshConnectionConfig } from "@deepseek-ai/dsh-ssh"
import z from "@deepseek-ai/schemastery"
import { type OpenedConnection, Reconnector } from "../host/reconnect"

export interface Config extends SshConnectionConfig {
  /** After a failed connect, calls fail fast with that error for this long. */
  retryDelayMs?: number
  /** Connections opened for one call before it fails. */
  connectAttempts?: number
}

const FRONT = Symbol("botVmSshFront")

type Request = SshConnection["request"]
type ConnectStream = SshConnection["connectStream"]

/**
 * dsh-ssh keeps its state private; this package reads the `failure` and
 * `closed` fields of the pinned version, and refuses a version without them.
 */
export function assertConnectionShape(connection: object): void {
  if (!Object.hasOwn(connection, "failure") || !Object.hasOwn(connection, "closed")) {
    throw new Error(
      "@deepseek-ai/dsh-ssh's SshConnection has no failure/closed fields: this @1outres/dsh-bot-vm does not support that dsh-ssh version",
    )
  }
}

/** Whether a dsh-ssh connection failed or closed. */
export function connectionFailed(connection: object): boolean {
  return (
    Reflect.get(connection, "failure") !== undefined || Reflect.get(connection, "closed") === true
  )
}

/**
 * Start one `SshConnection` as a child plugin of `ctx` under its own isolated
 * `ssh` scope, so it neither clashes with this service nor outlives it.
 */
function openConnection(
  ctx: Context,
  config: SshConnectionConfig,
): Promise<OpenedConnection<SshConnection>> {
  return new Promise((resolve, reject) => {
    const fiber = ctx.isolate("ssh").plugin({
      name: "dsh-bot-vm-ssh-connection",
      apply: (scope: Context) => {
        try {
          const connection = new SshConnection(scope, config)
          try {
            assertConnectionShape(connection)
          } catch (error) {
            void connection.dispose().catch(() => {})
            throw error
          }
          resolve({
            connection,
            close: async () => {
              await connection.dispose().catch(() => {})
              await fiber.dispose()
            },
          })
        } catch (error) {
          reject(error)
          throw error
        }
      },
    })
  })
}

export default class BotVmSsh extends Service {
  static Config: z<Config> = z.object({
    host: z.string().required().description("OpenSSH host alias of the bot VM."),
    launch: z
      .union([
        z.object({
          kind: z.const("node-script").required(),
          node: z.string().required(),
          bootstrapPath: z.string(),
          bootstrapHash: z.string(),
        }),
        z.object({ kind: z.const("executable").required() }),
      ])
      .required(),
    helper: z.string().required().description("Absolute guest path of dsh-ssh's lib/helper.js."),
    helperHash: z.string().required().description("SHA-256 of that helper."),
    workspace: z.string().required().description("Absolute guest default workspace."),
    requestTimeoutMs: z.number().default(30_000),
    maxFrameBytes: z.number().default(64 * 1024 * 1024),
    maxPending: z.number().default(128),
    leaseMs: z.number().default(30_000),
    retryDelayMs: z
      .number()
      .default(2_000)
      .description("After a failed connect, calls fail fast for this long before trying again."),
    connectAttempts: z
      .number()
      .default(2)
      .description(
        "Connections opened for one call before it fails: a VM that just booted can miss the first handshake deadline while it reads everything cold.",
      ),
  }) as z<Config>;

  [FRONT]: Reconnector<SshConnection>

  constructor(ctx: Context, config: Config) {
    super(ctx, "ssh")
    const { retryDelayMs = 2_000, connectAttempts = 2, ...connection } = config
    const front = new Reconnector<SshConnection>({
      host: config.host,
      open: () => openConnection(ctx, connection),
      failed: connectionFailed,
      retryDelayMs,
      connectAttempts,
      now: Date.now,
      log: (message) => ctx.logger.debug(message),
    })
    this[FRONT] = front
    ctx.effect(() => () => front.close(), "bot-vm: ssh connection")
  }

  /** The verified helper identity; connects when not connected. */
  get ready(): SshConnection["ready"] {
    const ready = this[FRONT].connection().then((connection) => connection.ready)
    void ready.catch(() => {})
    return ready
  }

  /** PTC launch coordinates of the connected helper. */
  get ptcLaunch(): SshConnection["ptcLaunch"] {
    const connection = this[FRONT].connected()
    if (connection === undefined) throw new Error("SSH helper is not ready")
    return connection.ptcLaunch
  }

  request<T>(...args: Parameters<Request>): Promise<T> {
    const [method, params, result, signal, wait] = args
    return this[FRONT].request(method, params, result, signal, wait) as Promise<T>
  }

  connectStream(...args: Parameters<ConnectStream>): ReturnType<ConnectStream> {
    return this[FRONT].connectStream(...args)
  }

  /** Close the current connection; the next call opens a new one. */
  dispose(): Promise<void> {
    return this[FRONT].reset()
  }
}
