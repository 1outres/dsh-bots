import type {
  BotConnectorEnvironment,
  BotEnvironmentCommand,
  BotEnvironmentCommandResult,
  BotEnvironmentProcess,
  BotEnvironmentSpawn,
} from "@1outres/dsh-bot-core"
import { GENERATED_SERVER } from "../src/host/catalog"

/** A process whose standard output the test (or `answer`) writes, line by line. */
export function fakeProcess(answer?: (message: Record<string, unknown>) => unknown) {
  const written: Record<string, unknown>[] = []
  const queue: Uint8Array[] = []
  let wake: (() => void) | undefined
  let ended = false
  let finish: (value: { exitCode: number | null; signal: string | null }) => void = () => {}
  const done = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
    finish = resolve
  })
  const push = (text: string) => {
    queue.push(new TextEncoder().encode(text))
    wake?.()
  }
  const end = () => {
    ended = true
    wake?.()
    finish({ exitCode: null, signal: "SIGTERM" })
  }
  const process: BotEnvironmentProcess = {
    stdin: {
      async write(data) {
        for (const line of new TextDecoder().decode(data).split("\n").filter(Boolean)) {
          const message = JSON.parse(line) as Record<string, unknown>
          written.push(message)
          if (answer === undefined || message.id === undefined || message.method === undefined) {
            continue
          }
          const result = answer(message)
          push(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, ...(result as object) })}\n`)
        }
      },
      async end() {},
    },
    stdout: {
      async *[Symbol.asyncIterator]() {
        while (true) {
          const chunk = queue.shift()
          if (chunk !== undefined) {
            yield chunk
            continue
          }
          if (ended) return
          await new Promise<void>((resolve) => {
            wake = resolve
          })
        }
      },
    },
    stderr: () => "",
    done,
    terminate: end,
  }
  return { process, written, push, end }
}

/** Answers as Playwright MCP: initialize, tools/list (the generated tools unless given), tools/call. */
export function playwrightAnswers(
  options: {
    readonly tools?: readonly unknown[]
    readonly call?: (name: string, args: unknown) => unknown
  } = {},
) {
  return (message: Record<string, unknown>) => {
    switch (message.method) {
      case "initialize":
        return {
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: { listChanged: true } },
            serverInfo: GENERATED_SERVER.server,
          },
        }
      case "tools/list":
        return { result: { tools: options.tools ?? GENERATED_SERVER.tools } }
      case "tools/call": {
        const params = message.params as { name: string; arguments: unknown }
        return {
          result: options.call?.(params.name, params.arguments) ?? {
            content: [{ type: "text", text: `ran ${params.name}` }],
          },
        }
      }
      default:
        return { error: { code: -32601, message: "no" } }
    }
  }
}

/** An environment answering commands from `answer` and spawning `spawn`'s processes. */
export function fakeEnvironment(
  answer: (
    command: BotEnvironmentCommand,
  ) => Partial<BotEnvironmentCommandResult> & { stdoutText?: string },
  spawn: (spec: BotEnvironmentSpawn) => BotEnvironmentProcess = () => {
    throw new Error("no process")
  },
) {
  const commands: BotEnvironmentCommand[] = []
  const spawned: BotEnvironmentSpawn[] = []
  const files = new Map<string, Uint8Array>()
  const environment: BotConnectorEnvironment = {
    workspace: "/home/bot/workspace",
    async exec(command) {
      commands.push(command)
      const { stdoutText, ...rest } = answer(command)
      return {
        exitCode: 0,
        signal: null,
        timedOut: false,
        stdout: new TextEncoder().encode(stdoutText ?? ""),
        stdoutTruncated: false,
        stderr: "",
        ...rest,
      }
    },
    async spawn(spec) {
      spawned.push(spec)
      return spawn(spec)
    },
    async readFile() {
      throw new Error("not read")
    },
    async writeFile(path, data) {
      files.set(path, data)
    },
  }
  return { environment, commands, spawned, files }
}

export const ACCOUNT = "1001\nbot\n/home/bot\n"
export const CHROME_VERSION = JSON.stringify({ Browser: "Chrome/158.0.8127.88" })

export const deadline = (ms: number) => AbortSignal.timeout(ms)

export const settle = async (rounds = 5) => {
  for (let index = 0; index < rounds; index++) await new Promise((resolve) => setImmediate(resolve))
}
