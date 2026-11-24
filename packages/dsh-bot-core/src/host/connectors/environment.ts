/**
 * A connector's way into the bot's environment (`BotConnectorEnvironment`):
 * commands through the environment's own `subprocess` (the bot's VM, as its
 * user), files with `sh` there. The subprocess is looked up at every call,
 * so a run uses the bot's currently registered preset revision.
 */
import type {
  BotConnectorEnvironment,
  BotEnvironmentCommandResult,
  BotEnvironmentProcess,
} from "../../connector-contract"

/** A piped stdin of a dsh-subprocess handle, structurally (Node's `Writable`). */
export interface PipedInput {
  write(chunk: Uint8Array, callback: (error?: Error | null) => void): unknown
  end(callback?: () => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
}

/** dsh-subprocess `SubprocessHandle` with piped stdout, structurally. */
export interface ConnectorProcessHandle {
  readonly stdin: PipedInput | undefined
  readonly stdout: AsyncIterable<Uint8Array> | undefined
  readonly collected: {
    readonly stderr?: { readFrom(offset: number): { readonly text: string } }
  }
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>
  terminate(): void
}

/** dsh-subprocess `SubprocessRuntime`, structurally, as connectors spawn with it. */
export interface ConnectorSubprocess {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    env?: Readonly<Record<string, string>>
    stdio: {
      stdin: "pipe" | "ignore"
      stdout: "pipe"
      stderr: { maxBytes: number }
    }
    graceMs: number
    signal: AbortSignal
  }): ConnectorProcessHandle
}

/** The environment of one bot while it is available. */
export interface EnvironmentAccess {
  readonly subprocess: ConnectorSubprocess
  readonly workspace: string
}

export interface ConnectorEnvironmentDeps {
  /** The bot's environment now, or undefined while it is not available. */
  access(): EnvironmentAccess | undefined
  /** The registered environment's workspace (also known while it is not available). */
  workspace: string
  /** A signal that aborts after `ms`. */
  deadline(ms: number): AbortSignal
}

const STDERR_BYTES = 16 * 1024
const GRACE_MS = 2000

const WRITE_FILE = [
  "set -eu",
  "target=$1 mode=$2",
  'dir=$(dirname -- "$target")',
  'tmp=$(mktemp -- "$dir/.dsh-connector.XXXXXX")',
  "trap 'rm -f -- \"$tmp\"' EXIT",
  'cat > "$tmp"',
  'chmod "$mode" "$tmp"',
  'mv -f -- "$tmp" "$target"',
  "trap - EXIT",
].join("\n")

const unavailable = () => new Error("the bot's environment is not available now")

function write(stdin: PipedInput, data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    stdin.write(data, (error) => (error ? reject(error) : resolve()))
  })
}

function close(stdin: PipedInput): Promise<void> {
  return new Promise((resolve) => {
    stdin.end(() => resolve())
  })
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const out = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

export function createConnectorEnvironment(
  deps: ConnectorEnvironmentDeps,
): BotConnectorEnvironment {
  const require = () => {
    const access = deps.access()
    if (access === undefined) throw unavailable()
    return access
  }

  const exec: BotConnectorEnvironment["exec"] = async (command) => {
    const access = require()
    const deadline = deps.deadline(command.timeoutMs)
    const signal =
      command.signal === undefined ? deadline : AbortSignal.any([deadline, command.signal])
    const handle = access.subprocess.spawn({
      argv: command.argv,
      cwd: command.cwd ?? access.workspace,
      ...(command.env === undefined ? {} : { env: command.env }),
      stdio: {
        stdin: command.stdin === undefined ? "ignore" : "pipe",
        stdout: "pipe",
        stderr: { maxBytes: STDERR_BYTES },
      },
      graceMs: GRACE_MS,
      signal,
    })
    if (command.stdin !== undefined) {
      const stdin = handle.stdin
      if (stdin === undefined) throw new Error("the environment gave the command no stdin")
      stdin.on("error", () => {})
      void write(stdin, command.stdin).then(
        () => close(stdin),
        () => {},
      )
    }
    const chunks: Uint8Array[] = []
    let kept = 0
    let truncated = false
    if (handle.stdout !== undefined) {
      for await (const chunk of handle.stdout) {
        const room = command.maxOutputBytes - kept
        if (chunk.byteLength > room) truncated = true
        if (room <= 0) continue
        const part = chunk.byteLength > room ? chunk.subarray(0, room) : chunk
        chunks.push(part)
        kept += part.byteLength
      }
    }
    const exit = await handle.done
    command.signal?.throwIfAborted()
    const result: BotEnvironmentCommandResult = {
      exitCode: exit.exitCode,
      signal: exit.signal,
      timedOut: deadline.aborted,
      stdout: concat(chunks, kept),
      stdoutTruncated: truncated,
      stderr: handle.collected.stderr?.readFrom(0).text ?? "",
    }
    return result
  }

  const spawn: BotConnectorEnvironment["spawn"] = async (request) => {
    const access = require()
    const handle = access.subprocess.spawn({
      argv: request.argv,
      cwd: request.cwd ?? access.workspace,
      ...(request.env === undefined ? {} : { env: request.env }),
      stdio: { stdin: "pipe", stdout: "pipe", stderr: { maxBytes: STDERR_BYTES } },
      graceMs: GRACE_MS,
      signal: request.signal,
    })
    const { stdin, stdout } = handle
    if (stdin === undefined || stdout === undefined) {
      handle.terminate()
      throw new Error("the environment did not pipe the process's input and output")
    }
    stdin.on("error", () => {})
    const process: BotEnvironmentProcess = {
      stdin: { write: (data) => write(stdin, data), end: () => close(stdin) },
      stdout,
      stderr: () => handle.collected.stderr?.readFrom(0).text ?? "",
      done: handle.done,
      terminate: () => handle.terminate(),
    }
    return process
  }

  const failure = (what: string, result: BotEnvironmentCommandResult) => {
    const status = result.timedOut
      ? "timed out"
      : result.signal !== null
        ? result.signal
        : `exit ${result.exitCode}`
    const detail = result.stderr.trim()
    return new Error(`${what} failed (${status})${detail === "" ? "" : `: ${detail}`}`)
  }

  return {
    workspace: deps.workspace,
    exec,
    spawn,
    async readFile(path, options) {
      const result = await exec({
        argv: ["head", "-c", String(options.maxBytes + 1), "--", path],
        timeoutMs: 60_000,
        maxOutputBytes: options.maxBytes + 1,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (result.exitCode !== 0) throw failure(`reading ${path}`, result)
      if (result.stdout.byteLength > options.maxBytes) {
        throw new Error(`${path} is larger than ${options.maxBytes} bytes`)
      }
      return result.stdout
    },
    async writeFile(path, data, options = {}) {
      const mode = (options.mode ?? 0o644).toString(8)
      const result = await exec({
        argv: ["sh", "-c", WRITE_FILE, "sh", path, mode],
        stdin: data,
        timeoutMs: 60_000,
        maxOutputBytes: 4096,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
      if (result.exitCode !== 0) throw failure(`writing ${path}`, result)
    },
  }
}
