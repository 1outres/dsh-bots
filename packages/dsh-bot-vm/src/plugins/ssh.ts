/**
 * `@1outres/dsh-bot-vm/ssh`: the `ssh` service of a bot's execution group.
 *
 * It serves the API of `@deepseek-ai/dsh-ssh`'s service (`request`,
 * `connectStream`, `ready`, `ptcLaunch`, `dispose`), which
 * `dsh-fs-ssh` and `dsh-subprocess-ssh` call, over this package's copy of
 * its connection (src/node/ssh/connection.ts), run with the bot's own OpenSSH
 * config (`ssh -F`). Connections are opened on first use, replaced after a
 * failure and closed when idle (src/host/reconnect.ts):
 *
 * - Mounting never connects, so a bot preset mounts while its VM is down;
 *   only the calls fail ("cannot reach the bot VM over SSH ...").
 * - Calls in flight at a failure still fail; nothing is replayed. Handles of
 *   a lost connection never reach its successor.
 * - `dispose()` (which the SSH providers call when remote cleanup cannot be
 *   confirmed) closes the current connection only when the latest failed call
 *   ran on it.
 */
import { type Context, Service } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { Reconnector } from "../host/reconnect"
import {
  SSH_CONNECTION_DEFAULTS,
  SshConnection,
  type SshConnectionConfig,
} from "../node/ssh/connection"

export interface Config extends SshConnectionConfig {
  /** After a failed connect, calls fail fast with that error for this long. */
  retryDelayMs?: number
  /** Connections opened for one call before it fails. */
  connectAttempts?: number
  /** A connection nothing used for this long is closed; 0 keeps it. */
  idleMs?: number
}

const FRONT = Symbol("botVmSshFront")

type Request = SshConnection["request"]
type ConnectStream = SshConnection["connectStream"]

export default class BotVmSsh extends Service {
  static Config: z<Config> = z.object({
    host: z.string().required().description("OpenSSH host alias of the bot VM."),
    configFile: z.string().required().description("The bot's OpenSSH client config (ssh -F)."),
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
    requestTimeoutMs: z.number().default(SSH_CONNECTION_DEFAULTS.requestTimeoutMs),
    maxFrameBytes: z.number().default(SSH_CONNECTION_DEFAULTS.maxFrameBytes),
    maxPending: z.number().default(SSH_CONNECTION_DEFAULTS.maxPending),
    leaseMs: z.number().default(SSH_CONNECTION_DEFAULTS.leaseMs),
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
    idleMs: z
      .number()
      .default(300_000)
      .description(
        "A connection with no call, stream or remote process for this long is closed (0: never).",
      ),
  }) as z<Config>;

  [FRONT]: Reconnector<SshConnection>

  constructor(ctx: Context, config: Config) {
    super(ctx, "ssh")
    const { retryDelayMs = 2_000, connectAttempts = 2, idleMs = 300_000, ...connection } = config
    const front = new Reconnector<SshConnection>({
      host: config.host,
      open: async () => {
        const opened = new SshConnection(connection)
        return { connection: opened, close: () => opened.dispose().catch(() => {}) }
      },
      failed: (opened) => opened.failed,
      retryDelayMs,
      connectAttempts,
      idleMs,
      now: Date.now,
      later: (ms, task) => {
        const timer = setTimeout(task, ms)
        timer.unref()
        return () => clearTimeout(timer)
      },
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
