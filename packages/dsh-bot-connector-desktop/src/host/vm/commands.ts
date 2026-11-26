import type { BotConnectorEnvironment, BotEnvironmentCommandResult } from "@1outres/dsh-bot-core"
import type { VmUser } from "./layout"

export interface CommandOptions {
  readonly timeoutMs?: number
  readonly maxOutputBytes?: number
  readonly env?: Readonly<Record<string, string>>
  readonly stdin?: Uint8Array
  readonly signal: AbortSignal
  readonly accept?: readonly number[]
}

export class CommandError extends Error {
  constructor(argv: readonly string[], result: BotEnvironmentCommandResult) {
    const status = result.timedOut
      ? "timed out"
      : result.signal !== null
        ? `signal ${result.signal}`
        : `exit ${result.exitCode}`
    const detail = result.stderr.trim().split("\n").slice(-6).join("\n")
    super(`${argv.slice(0, 4).join(" ")} failed (${status})${detail === "" ? "" : `: ${detail}`}`)
    this.name = "CommandError"
  }
}

export async function run(
  environment: BotConnectorEnvironment,
  argv: readonly string[],
  options: CommandOptions,
): Promise<{ readonly exitCode: number; readonly stdout: string }> {
  const result = await environment.exec({
    argv,
    timeoutMs: options.timeoutMs ?? 60_000,
    maxOutputBytes: options.maxOutputBytes ?? 64 * 1024,
    signal: options.signal,
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
  })
  options.signal.throwIfAborted()
  const accepted = options.accept ?? [0]
  if (result.timedOut || result.exitCode === null || !accepted.includes(result.exitCode)) {
    throw new CommandError(argv, result)
  }
  return { exitCode: result.exitCode, stdout: new TextDecoder().decode(result.stdout) }
}

const ACCOUNT = 'id -u; id -un; printf "%s\\n" "$HOME"'

export async function readVmUser(
  environment: BotConnectorEnvironment,
  signal: AbortSignal,
): Promise<VmUser> {
  const { stdout } = await run(environment, ["sh", "-c", ACCOUNT], { signal, timeoutMs: 30_000 })
  const [uid, name, home] = stdout.split("\n")
  if (
    uid === undefined ||
    !/^[0-9]{1,9}$/.test(uid) ||
    name === undefined ||
    !/^[a-z_][a-z0-9_-]{0,31}$/.test(name) ||
    home === undefined ||
    !/^\/[^\0\n]*$/.test(home)
  ) {
    throw new Error("the bot's account in its environment could not be read")
  }
  return { uid: Number(uid), name, home }
}
