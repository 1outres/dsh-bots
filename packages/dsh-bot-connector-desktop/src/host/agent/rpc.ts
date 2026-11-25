/**
 * Newline-delimited JSON-RPC 2.0 over a byte stream (`socat` to the agent's
 * Unix socket in the bot's VM). Replies are matched by id; a line longer
 * than the limit, or a stream that ends, fails every open call.
 *
 * A request that carries a secret (docs/specs/bot-vaults.md §6) has it in its
 * own `secret` member, base64: the line is assembled as bytes around the
 * value, never as a JS string, and wiped once written.
 */
import type { BotEnvironmentProcess, SecretBytes, VaultKit } from "@1outres/dsh-bot-core"
import { type Check, integer, json, matching, nullable, object, text } from "./check"

export interface RpcDeps {
  /** A signal that aborts after `ms`. */
  deadline(ms: number): AbortSignal
}

export interface RpcClientDeps extends RpcDeps {
  /** Byte encodings for a request that carries a secret (`Bot.vaultKit()`). */
  readonly vaultKit: VaultKit
}

export interface RpcCall {
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

export interface RpcClient {
  call(method: string, params: object, options: RpcCall): Promise<unknown>
  /** A call whose request also carries the secret; the secret is wiped in every case. */
  callSecret(
    method: string,
    params: object,
    secret: SecretBytes,
    options: RpcCall,
  ): Promise<unknown>
  /** Settles once the stream ended; every later call fails. */
  readonly closed: Promise<void>
}

/** An error the agent answered with (its code and message). */
export class AgentCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "AgentCallError"
  }
}

export class AgentUnavailableError extends Error {
  constructor(reason: string) {
    super(`the desktop agent is not reachable: ${reason}`)
    this.name = "AgentUnavailableError"
  }
}

const NEWLINE = 0x0a
const SECRET_OPEN = new TextEncoder().encode(',"secret":"')
const SECRET_CLOSE = new TextEncoder().encode('"}\n')
const reply: Check<{
  readonly id: number
  readonly result?: unknown
  readonly error?: { readonly code: string; readonly message: string } | null
}> = object(
  { id: integer(1, Number.MAX_SAFE_INTEGER) },
  {
    result: json(128, Number.MAX_SAFE_INTEGER),
    error: nullable(object({ code: matching(/^[a-z_]{1,64}$/, 64), message: text(4_000) })),
  },
)

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

export function createRpcClient(
  process: Pick<BotEnvironmentProcess, "stdin" | "stdout">,
  deps: RpcClientDeps,
  limits: { readonly maxLineBytes: number },
): RpcClient {
  const pending = new Map<number, Pending>()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let nextId = 1
  let failure: Error | undefined

  const failAll = (error: Error) => {
    failure ??= error
    for (const entry of pending.values()) entry.reject(failure)
    pending.clear()
  }

  const receive = (line: Uint8Array) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(decoder.decode(line))
    } catch {
      throw new AgentUnavailableError("it sent a line that is not JSON")
    }
    const message = reply(parsed, "reply")
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined && message.error !== null) {
      entry.reject(new AgentCallError(message.error.code, message.error.message))
    } else if ("result" in message) {
      entry.resolve(message.result)
    } else {
      entry.reject(new AgentUnavailableError("it answered without a result"))
    }
  }

  const read = async () => {
    let buffer = new Uint8Array(0)
    for await (const chunk of process.stdout) {
      const joined = new Uint8Array(buffer.byteLength + chunk.byteLength)
      joined.set(buffer)
      joined.set(chunk, buffer.byteLength)
      buffer = joined
      let start = 0
      for (
        let index = buffer.indexOf(NEWLINE);
        index >= 0;
        index = buffer.indexOf(NEWLINE, start)
      ) {
        receive(buffer.subarray(start, index))
        start = index + 1
      }
      buffer = buffer.slice(start)
      if (buffer.byteLength > limits.maxLineBytes) {
        throw new AgentUnavailableError(`it sent a line longer than ${limits.maxLineBytes} bytes`)
      }
    }
    throw new AgentUnavailableError("the connection ended")
  }

  const closed = read().catch((error: unknown) => {
    failAll(error instanceof Error ? error : new AgentUnavailableError(String(error)))
  })

  const open = (method: string, options: RpcCall) => {
    if (failure !== undefined) throw failure
    const id = nextId++
    const deadline = deps.deadline(options.timeoutMs)
    const signal =
      options.signal === undefined ? deadline : AbortSignal.any([deadline, options.signal])
    const answer = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      signal.addEventListener(
        "abort",
        () => {
          if (!pending.delete(id)) return
          reject(
            deadline.aborted
              ? new AgentUnavailableError(`${method} took longer than ${options.timeoutMs} ms`)
              : signal.reason instanceof Error
                ? signal.reason
                : new Error("cancelled"),
          )
        },
        { once: true },
      )
    })
    return { id, answer }
  }

  const send = async (id: number, write: () => Promise<void>) => {
    try {
      await write()
    } catch (error) {
      pending.delete(id)
      throw new AgentUnavailableError(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    closed,
    async call(method, params, options) {
      const { id, answer } = open(method, options)
      const line = encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      await send(id, () => process.stdin.write(line))
      return answer
    },
    async callSecret(method, params, secret, options) {
      const kit = deps.vaultKit
      try {
        const { id, answer } = open(method, options)
        const request = encoder.encode(JSON.stringify({ jsonrpc: "2.0", id, method, params }))
        const head = kit.concat([request.subarray(0, request.byteLength - 1), SECRET_OPEN])
        await send(id, () =>
          secret.use(async (bytes) => {
            const encoded = kit.base64(bytes)
            const line = kit.concat([head, encoded, SECRET_CLOSE])
            try {
              await process.stdin.write(line)
            } finally {
              kit.wipe(encoded, line)
            }
          }),
        )
        return answer
      } finally {
        secret.wipe()
      }
    },
  }
}
