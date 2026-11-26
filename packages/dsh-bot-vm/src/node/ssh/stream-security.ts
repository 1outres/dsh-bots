import type { Socket } from "node:net"
import { type ConnectionOptions, connect, type TLSSocket } from "node:tls"

export const SSH_STREAM_TLS_OPTIONS = {
  ciphers: "PSK-AES256-GCM-SHA384",
  minVersion: "TLSv1.2",
  maxVersion: "TLSv1.2",
} as const satisfies ConnectionOptions

export async function authenticateStream(
  socket: Socket,
  capability: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<TLSSocket> {
  if (signal?.aborted) {
    socket.destroy()
    signal.throwIfAborted()
  }
  const stream = connect({
    ...SSH_STREAM_TLS_OPTIONS,
    socket,
    rejectUnauthorized: true,
    pskCallback: () => ({ psk: Buffer.from(capability, "hex"), identity: "dsh-stream" }),
    checkServerIdentity: () => undefined,
  })
  const abort = (): void => {
    stream.destroy(
      signal?.reason instanceof Error ? signal.reason : new Error(String(signal?.reason)),
    )
  }
  signal?.addEventListener("abort", abort, { once: true })
  stream.once("close", () => {
    signal?.removeEventListener("abort", abort)
  })
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        stream.off("secureConnect", secured)
        stream.off("error", failed)
        stream.off("close", closed)
        clearTimeout(timer)
      }
      const secured = (): void => {
        cleanup()
        stream.disableRenegotiation()
        stream.pause()
        resolve()
      }
      const failed = (error: Error): void => {
        cleanup()
        reject(error)
      }
      const closed = (): void => {
        failed(new Error("SSH stream closed during authentication"))
      }
      const timer = setTimeout(() => {
        failed(new Error("SSH stream authentication timed out"))
      }, timeoutMs)
      stream.once("secureConnect", secured)
      stream.once("error", failed)
      stream.once("close", closed)
    })
    return stream
  } catch (error) {
    stream.destroy()
    throw error
  }
}
