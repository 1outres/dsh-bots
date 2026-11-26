import { connect } from "node:net"

const REACH_TIMEOUT_MS = 10_000

export function tcpReachable(url: string, signal: AbortSignal): Promise<void> {
  const { hostname, port } = new URL(url)
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    const socket = connect({
      host: hostname.replace(/^\[(.*)\]$/, "$1"),
      port: Number(port || 443),
    })
    const finish = (error?: Error) => {
      clearTimeout(timer)
      signal.removeEventListener("abort", aborted)
      socket.destroy()
      if (error === undefined) resolve()
      else reject(error)
    }
    const aborted = () =>
      finish(signal.reason instanceof Error ? signal.reason : new Error("aborted"))
    const timer = setTimeout(
      () => finish(new Error(`no answer within ${REACH_TIMEOUT_MS / 1000} seconds`)),
      REACH_TIMEOUT_MS,
    )
    signal.addEventListener("abort", aborted, { once: true })
    socket.once("connect", () => finish())
    socket.once("error", (error) => finish(error))
  })
}
