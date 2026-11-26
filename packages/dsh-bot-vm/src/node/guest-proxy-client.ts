import { connect } from "node:net"
import type { Readable, Writable } from "node:stream"
import { RELAY_READY, requestLine } from "../host/guest-transport"
import { readLine } from "./line"

export interface GuestProxyStreams {
  readonly stdin: Readable
  readonly stdout: Writable
  readonly stderr: Writable
}

const ANSWER_TIMEOUT_MS = 60_000

export async function runGuestProxy(
  socketPath: string,
  instance: string,
  io: GuestProxyStreams,
): Promise<number> {
  const socket = connect({ path: socketPath, allowHalfOpen: true })
  const fail = (message: string) => {
    io.stderr.write(`dsh-bot-vm guest-proxy: ${message}\n`)
    socket.destroy()
    return 255
  }
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve)
      socket.once("error", reject)
    })
  } catch (error) {
    return fail(
      `cannot reach the relay of DSH at ${socketPath} (is DSH running?): ${(error as Error).message}`,
    )
  }
  socket.write(requestLine(instance))
  let answer: string
  try {
    answer = await readLine(socket, ANSWER_TIMEOUT_MS)
  } catch (error) {
    return fail((error as Error).message)
  }
  if (answer !== RELAY_READY) return fail(answer.replace(/^error /, ""))
  return new Promise((resolve) => {
    io.stdin.pipe(socket)
    socket.pipe(io.stdout)
    socket.once("end", () => io.stdout.end(() => resolve(0)))
    socket.once("error", (error) => resolve(fail(error.message)))
  })
}
