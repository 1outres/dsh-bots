import type { BotEnvironmentProcess } from "@1outres/dsh-bot-core"
import { McpProtocolError } from "./protocol"

export interface McpClientDeps {
  deadline(ms: number): AbortSignal
}

export interface McpRequestOptions {
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

export interface McpClient {
  request(method: string, params: object, options: McpRequestOptions): Promise<unknown>
  notify(method: string, params?: object): Promise<void>
  readonly closed: Promise<void>
}

export class McpCallError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message)
    this.name = "McpCallError"
  }
}

export class McpUnavailableError extends Error {
  constructor(reason: string) {
    super(`Playwright MCP is not reachable: ${reason}`)
    this.name = "McpUnavailableError"
  }
}

const NEWLINE = 0x0a
const METHOD_NOT_FOUND = -32601

interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export function createMcpClient(
  process: Pick<BotEnvironmentProcess, "stdin" | "stdout">,
  deps: McpClientDeps,
  limits: { readonly maxLineBytes: number },
): McpClient {
  const pending = new Map<number, Pending>()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let nextId = 1
  let failure: Error | undefined

  const send = (message: object) =>
    process.stdin.write(encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`))

  const failAll = (error: Error) => {
    failure ??= error
    for (const entry of pending.values()) entry.reject(failure)
    pending.clear()
  }

  const answerRequest = (id: unknown, method: string) => {
    if (typeof id !== "number" && typeof id !== "string") return
    void send(
      method === "ping"
        ? { id, result: {} }
        : { id, error: { code: METHOD_NOT_FOUND, message: `${method} is not supported` } },
    ).catch(() => {})
  }

  const receive = (line: Uint8Array) => {
    let message: unknown
    try {
      message = JSON.parse(decoder.decode(line))
    } catch {
      throw new McpProtocolError("a line that is not JSON")
    }
    if (!isRecord(message) || message.jsonrpc !== "2.0") {
      throw new McpProtocolError("a line that is not JSON-RPC 2.0")
    }
    if (typeof message.method === "string") {
      if ("id" in message) answerRequest(message.id, message.method)
      return
    }
    if (typeof message.id !== "number") throw new McpProtocolError("a reply without a request id")
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    const { error } = message
    if (error !== undefined) {
      const code = isRecord(error) && typeof error.code === "number" ? error.code : 0
      const text = isRecord(error) && typeof error.message === "string" ? error.message : "an error"
      entry.reject(new McpCallError(code, text.slice(0, 4_000)))
    } else if ("result" in message) {
      entry.resolve(message.result)
    } else {
      entry.reject(new McpProtocolError("a reply without a result"))
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
        throw new McpProtocolError(`a line longer than ${limits.maxLineBytes} bytes`)
      }
    }
    throw new McpUnavailableError("its process ended")
  }

  const closed = read().catch((error: unknown) => {
    failAll(error instanceof Error ? error : new McpUnavailableError(String(error)))
  })

  return {
    closed,
    async notify(method, params) {
      if (failure !== undefined) throw failure
      await send(params === undefined ? { method } : { method, params })
    },
    async request(method, params, options) {
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
            const reason = deadline.aborted
              ? `${method} took longer than ${options.timeoutMs} ms`
              : "cancelled"
            void send({
              method: "notifications/cancelled",
              params: { requestId: id, reason },
            }).catch(() => {})
            reject(
              deadline.aborted
                ? new McpUnavailableError(reason)
                : signal.reason instanceof Error
                  ? signal.reason
                  : new Error(reason),
            )
          },
          { once: true },
        )
      })
      try {
        await send({ id, method, params })
      } catch (error) {
        pending.delete(id)
        throw new McpUnavailableError(error instanceof Error ? error.message : String(error))
      }
      return answer
    },
  }
}
