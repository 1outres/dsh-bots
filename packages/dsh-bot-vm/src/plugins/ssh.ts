import { type Context, Service } from "@deepseek-ai/cordis"
import z from "@deepseek-ai/schemastery"
import { Reconnector } from "../host/reconnect"
import {
  SSH_CONNECTION_DEFAULTS,
  SshConnection,
  type SshConnectionConfig,
} from "../node/ssh/connection"

export interface Config extends SshConnectionConfig {
  retryDelayMs?: number
  connectAttempts?: number
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

  get ready(): SshConnection["ready"] {
    const ready = this[FRONT].connection().then((connection) => connection.ready)
    void ready.catch(() => {})
    return ready
  }

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

  dispose(): Promise<void> {
    return this[FRONT].reset()
  }
}
