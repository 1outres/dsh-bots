import { connect, type Socket } from "node:net"
import type { GuestChannel } from "../host/backend/contract"

const CONNECT_TIMEOUT_MS = 10_000

function opened(host: string, port: number, signal?: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const socket = connect({ host, port, allowHalfOpen: true })
    const finish = (error?: Error) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", aborted)
      if (error === undefined) {
        resolve(socket)
        return
      }
      socket.destroy()
      reject(error)
    }
    const aborted = () =>
      finish(signal?.reason instanceof Error ? signal.reason : new Error("aborted"))
    const timer = setTimeout(
      () => finish(new Error(`no answer within ${CONNECT_TIMEOUT_MS / 1000} seconds`)),
      CONNECT_TIMEOUT_MS,
    )
    signal?.addEventListener("abort", aborted, { once: true })
    socket.once("connect", () => finish())
    socket.once("error", (error) => finish(error))
  })
}

async function* nothing(): AsyncIterable<Uint8Array> {}

export async function tcpGuest(
  host: string,
  port: number,
  signal?: AbortSignal,
): Promise<GuestChannel> {
  const socket = await opened(host, port, signal)
  socket.setNoDelay(true)
  socket.on("error", () => {})
  return {
    input: {
      write: (data) =>
        new Promise((resolve, reject) => {
          socket.write(data, (error) => (error ? reject(error) : resolve()))
        }),
      end: () =>
        new Promise((resolve) => {
          socket.end(() => resolve())
        }),
    },
    output: socket,
    diagnostics: nothing(),
    close: () => socket.destroy(),
  }
}

export async function tcpReach(host: string, port: number, signal?: AbortSignal): Promise<void> {
  ;(await opened(host, port, signal)).destroy()
}
