import { chmod, mkdir, rm } from "node:fs/promises"
import { connect, createServer, type Server, type Socket } from "node:net"
import { dirname } from "node:path"
import type { GuestChannel } from "../host/backend/contract"
import { answerLine } from "../host/guest-transport"
import { readLine } from "./line"

export interface GuestRelayOptions {
  readonly socket: string
  open(instance: string, signal: AbortSignal): Promise<GuestChannel>
  readonly log: (message: string) => void
  readonly requestTimeoutMs: number
}

export interface GuestRelay {
  close(): Promise<void>
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function relay(connection: Socket, session: GuestChannel, log: (message: string) => void) {
  const toGuest = (async () => {
    for await (const chunk of connection) await session.input.write(chunk as Buffer)
    await session.input.end()
  })()
  const fromGuest = (async () => {
    for await (const chunk of session.output) {
      if (!connection.write(chunk))
        await new Promise((resolve) => connection.once("drain", resolve))
    }
    connection.end()
  })()
  const diagnostics = (async () => {
    for await (const chunk of session.diagnostics)
      log(Buffer.from(chunk).toString("utf8").trimEnd())
  })()
  await Promise.allSettled([toGuest, fromGuest, diagnostics])
}

export async function startGuestRelay(options: GuestRelayOptions): Promise<GuestRelay> {
  const lifetime = new AbortController()
  const connections = new Set<Socket>()
  const sessions = new Set<GuestChannel>()
  const server: Server = createServer({ allowHalfOpen: true }, (connection) => {
    connections.add(connection)
    connection.once("close", () => connections.delete(connection))
    connection.on("error", () => {})
    void (async () => {
      let instance = ""
      let session: GuestChannel | undefined
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
        session.close()
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
      for (const session of sessions) session.close()
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
