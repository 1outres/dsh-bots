/**
 * The relay of src/host/guest-transport.ts: a Unix socket in the DSH process.
 * Each connection names an instance; the relay asks `open` for the command's
 * streams (`sshd -i` in that instance) and carries the bytes both ways. The
 * proxy's end of file is the command's; the command's stdout ending ends the
 * connection.
 */
import { chmod, mkdir, rm } from "node:fs/promises"
import { connect, createServer, type Server, type Socket } from "node:net"
import { dirname } from "node:path"
import { answerLine } from "../host/guest-transport"
import type { ExecSession } from "../host/incus"
import { readLine } from "./line"

export interface GuestRelayOptions {
  readonly socket: string
  /** The streams of the guest's sshd for this instance; rejects when it may not be reached. */
  open(instance: string, signal: AbortSignal): Promise<ExecSession>
  readonly log: (message: string) => void
  /** How long a new connection may take to name its instance. */
  readonly requestTimeoutMs: number
}

export interface GuestRelay {
  close(): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function relay(connection: Socket, session: ExecSession, log: (message: string) => void) {
  const toGuest = (async () => {
    for await (const chunk of connection) await session.stdin.write(chunk as Buffer)
    await session.stdin.end()
  })()
  const fromGuest = (async () => {
    for await (const chunk of session.stdout) {
      if (!connection.write(chunk))
        await new Promise((resolve) => connection.once("drain", resolve))
    }
    connection.end()
  })()
  const diagnostics = (async () => {
    for await (const chunk of session.stderr) log(Buffer.from(chunk).toString("utf8").trimEnd())
  })()
  await Promise.allSettled([toGuest, fromGuest, diagnostics])
}

/** Listen on `options.socket`; a stale socket file of an earlier process is replaced. */
export async function startGuestRelay(options: GuestRelayOptions): Promise<GuestRelay> {
  const lifetime = new AbortController()
  const connections = new Set<Socket>()
  const sessions = new Set<ExecSession>()
  const server: Server = createServer({ allowHalfOpen: true }, (connection) => {
    connections.add(connection)
    connection.once("close", () => connections.delete(connection))
    connection.on("error", () => {})
    void (async () => {
      let instance = ""
      let session: ExecSession | undefined
      try {
        instance = await readLine(connection, options.requestTimeoutMs)
        session = await options.open(instance, lifetime.signal)
      } catch (error) {
        options.log(`guest relay: ${instance || "(no instance)"}: ${messageOf(error)}`)
        connection.end(answerLine(messageOf(error)))
        return
      }
      sessions.add(session)
      connection.write(answerLine())
      connection.resume()
      try {
        await relay(connection, session, (line) => options.log(`guest relay: ${instance}: ${line}`))
      } finally {
        session.destroy()
        sessions.delete(session)
        connection.destroy()
      }
    })()
  })
  await mkdir(dirname(options.socket), { recursive: true, mode: 0o700 })
  await chmod(dirname(options.socket), 0o700)
  await listen(server, options.socket)
  return {
    async close() {
      lifetime.abort(new Error("the guest relay is closing"))
      await new Promise<void>((resolve) => server.close(() => resolve()))
      for (const session of sessions) session.destroy()
      for (const connection of connections) connection.destroy()
    },
  }
}

async function listen(server: Server, path: string): Promise<void> {
  const attempt = () =>
    new Promise<void>((resolve, reject) => {
      server.once("error", reject)
      server.listen(path, () => {
        server.off("error", reject)
        resolve()
      })
    })
  try {
    await attempt()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error
    if (await answers(path)) {
      throw new Error(
        `another process relays on ${path}; two DSH processes share this state directory`,
      )
    }
    await rm(path, { force: true })
    await attempt()
  }
}

function answers(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(path)
    probe.once("connect", () => {
      probe.destroy()
      resolve(true)
    })
    probe.once("error", () => resolve(false))
  })
}
