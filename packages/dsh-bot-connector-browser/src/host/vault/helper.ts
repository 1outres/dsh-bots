/**
 * One run of a login helper in the bot's VM, spoken to over its standard
 * input and output (vault/protocol.ts). A secret reaches it only as raw
 * bytes on its standard input, written from one array that is wiped right
 * after: never in its argv or environment, never as a JS string.
 */
import type {
  BotConnectorEnvironment,
  BotEnvironmentProcess,
  SecretBytes,
  VaultKit,
} from "@1outres/dsh-bot-core"
import { HelperProtocolError, type HelperReply, parseReply } from "./protocol"

const MAX_LINE_BYTES = 4096
const NEWLINE = 0x0a

export class HelperEndedError extends Error {
  constructor() {
    super("the browser's login helper ended without an answer")
    this.name = "HelperEndedError"
  }
}

export interface HelperRun {
  /** The next answer. @throws when the helper ended or answered something malformed. */
  next(): Promise<HelperReply>
  send(message: object): Promise<void>
  /** A line made by `header(secret.length)`, then the secret's bytes; the secret is spent. */
  sendSecret(header: (length: number) => object, secret: SecretBytes): Promise<void>
  /** Close its input: a helper waiting for an order stops (nothing was filled). */
  end(): Promise<void>
  terminate(): void
  readonly done: Promise<unknown>
}

async function* lines(stdout: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let buffer = new Uint8Array(0)
  for await (const chunk of stdout) {
    const joined = new Uint8Array(buffer.byteLength + chunk.byteLength)
    joined.set(buffer)
    joined.set(chunk, buffer.byteLength)
    buffer = joined
    let index = buffer.indexOf(NEWLINE)
    while (index >= 0) {
      yield buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      index = buffer.indexOf(NEWLINE)
    }
    if (buffer.byteLength > MAX_LINE_BYTES) {
      throw new HelperProtocolError(`a line longer than ${MAX_LINE_BYTES} bytes`)
    }
  }
}

export function helperRun(process: BotEnvironmentProcess, kit: VaultKit): HelperRun {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  const reader = lines(process.stdout)
  return {
    done: process.done,
    async next() {
      const line = await reader.next()
      if (line.done === true) throw new HelperEndedError()
      let value: unknown
      try {
        value = JSON.parse(decoder.decode(line.value))
      } catch {
        throw new HelperProtocolError("a line that is not JSON")
      }
      return parseReply(value)
    },
    send: (message) => process.stdin.write(encoder.encode(`${JSON.stringify(message)}\n`)),
    async sendSecret(header, secret) {
      const line = encoder.encode(`${JSON.stringify(header(secret.length))}\n`)
      await secret.use(async (bytes) => {
        const frame = kit.concat([line, bytes])
        try {
          await process.stdin.write(frame)
        } finally {
          kit.wipe(frame)
        }
      })
    },
    end: () => process.stdin.end(),
    terminate: () => process.terminate(),
  }
}

export async function startHelper(
  environment: BotConnectorEnvironment,
  script: string,
  signal: AbortSignal,
  kit: VaultKit,
): Promise<HelperRun> {
  return helperRun(await environment.spawn({ argv: ["node", script], signal }), kit)
}
