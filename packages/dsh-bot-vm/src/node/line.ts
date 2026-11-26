import type { Socket } from "node:net"

const MAX_LINE = 4096

export function readLine(socket: Socket, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffered = Buffer.alloc(0)
    const done = (error: Error | undefined, line?: string) => {
      clearTimeout(timer)
      socket.off("data", data)
      socket.off("end", ended)
      socket.off("error", done)
      if (error !== undefined) reject(error)
      else resolve(line as string)
    }
    const data = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk])
      const end = buffered.indexOf(0x0a)
      if (end < 0) {
        if (buffered.length > MAX_LINE) done(new Error("the first line is too long"))
        return
      }
      socket.pause()
      const rest = buffered.subarray(end + 1)
      if (rest.length > 0) socket.unshift(rest)
      done(undefined, buffered.subarray(0, end).toString("utf8"))
    }
    const ended = () => done(new Error("the peer closed before the first line"))
    const timer = setTimeout(() => done(new Error("no first line in time")), timeoutMs)
    socket.on("data", data)
    socket.once("end", ended)
    socket.once("error", done)
  })
}
