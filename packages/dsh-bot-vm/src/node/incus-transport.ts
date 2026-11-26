import { createHash, randomBytes } from "node:crypto"
import { Agent, type ClientRequest, type IncomingMessage, request } from "node:http"
import { isIP, connect as netConnect, type Socket } from "node:net"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { connect as tlsConnect } from "node:tls"
import type { IncusEndpoint } from "../host/endpoint"
import type { ByteChannel, IncusResponse, IncusTransport } from "../host/incus"
import { websocketAccept, websocketChannel } from "./websocket"

export class CertificatePinError extends Error {
  constructor(
    readonly url: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `the server at ${url} presented the certificate ${actual}, not the pinned ${expected}; refusing to talk to it`,
    )
    this.name = "CertificatePinError"
  }
}

type Connector = (callback: (error: Error | null, socket?: Socket) => void) => void

function localConnector(socketPath: string): Connector {
  return (callback) => {
    const socket = netConnect({ path: socketPath })
    const failed = (error: Error) =>
      callback(new Error(`Incus socket ${socketPath}: ${error.message}`, { cause: error }))
    socket.once("error", failed)
    socket.once("connect", () => {
      socket.off("error", failed)
      callback(null, socket)
    })
  }
}

function remoteConnector(endpoint: IncusEndpoint & { kind: "remote" }): Connector {
  const url = new URL(endpoint.url)
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const port = Number(url.port === "" ? 8443 : url.port)
  return (callback) => {
    const socket = tlsConnect({
      host,
      port,
      ...(isIP(host) === 0 ? { servername: host } : {}),
      cert: endpoint.clientCertificate,
      key: endpoint.clientKey,
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    })
    const failed = (error: Error) => {
      socket.destroy()
      callback(new Error(`Incus at ${endpoint.url}: ${error.message}`, { cause: error }))
    }
    socket.once("error", failed)
    socket.once("secureConnect", () => {
      socket.off("error", failed)
      const raw = socket.getPeerCertificate().raw as Buffer | undefined
      const actual = raw === undefined ? "(none)" : createHash("sha256").update(raw).digest("hex")
      if (actual !== endpoint.serverCertificateSha256) {
        socket.destroy()
        callback(new CertificatePinError(endpoint.url, endpoint.serverCertificateSha256, actual))
        return
      }
      callback(null, socket)
    })
  }
}

function agentOf(connect: Connector, keepAlive: boolean): Agent {
  const agent = new Agent({ keepAlive, maxSockets: keepAlive ? 16 : Number.POSITIVE_INFINITY })
  Object.assign(agent, {
    createConnection: (
      _options: unknown,
      callback: (error: Error | null, socket?: Socket) => void,
    ) => {
      connect(callback)
      return undefined
    },
  })
  return agent
}

async function bodyOf(response: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString("utf8")
  if (text === "") return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export interface ClosableIncusTransport extends IncusTransport {
  close(): void
}

export function createIncusTransport(endpoint: IncusEndpoint): ClosableIncusTransport {
  const connect =
    endpoint.kind === "local" ? localConnector(endpoint.socket) : remoteConnector(endpoint)
  const pooled = agentOf(connect, true)
  const single = agentOf(connect, false)
  const upgraded = new Set<Socket>()

  const exchange = (
    method: string,
    path: string,
    headers: Readonly<Record<string, string | number>>,
    signal: AbortSignal | undefined,
    send: (req: ClientRequest) => Promise<void>,
  ) =>
    new Promise<IncusResponse>((resolve, reject) => {
      const req = request({
        agent: pooled,
        method,
        path,
        signal,
        headers: { Host: "incus", ...headers },
      })
      req.once("error", reject)
      req.once("response", (response) => {
        bodyOf(response).then((body) => resolve({ status: response.statusCode ?? 0, body }), reject)
      })
      send(req).catch((error: unknown) => {
        req.destroy(error as Error)
        reject(error)
      })
    })

  return {
    json(method, path, body, signal) {
      const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body))
      const headers: Record<string, string | number> =
        payload === undefined
          ? {}
          : { "Content-Type": "application/json", "Content-Length": payload.length }
      return exchange(method, path, headers, signal, async (req) => {
        req.end(payload)
      })
    },
    upload(path, body, headers, signal) {
      return exchange("POST", path, headers, signal, (req) => pipeline(Readable.from(body), req))
    },
    websocket(path, signal) {
      return new Promise<ByteChannel>((resolve, reject) => {
        const key = randomBytes(16).toString("base64")
        const req = request({
          agent: single,
          method: "GET",
          path,
          signal,
          headers: {
            Host: "incus",
            Connection: "Upgrade",
            Upgrade: "websocket",
            "Sec-WebSocket-Key": key,
            "Sec-WebSocket-Version": "13",
          },
        })
        req.once("error", reject)
        req.once("upgrade", (response, socket, head) => {
          if (response.headers["sec-websocket-accept"] !== websocketAccept(key)) {
            socket.destroy()
            reject(new Error(`Incus websocket ${path.split("?")[0]}: bad handshake`))
            return
          }
          const opened = socket as Socket
          upgraded.add(opened)
          opened.once("close", () => upgraded.delete(opened))
          opened.setNoDelay(true)
          resolve(websocketChannel(socket, head, true))
        })
        req.once("response", (response) => {
          bodyOf(response).then((body) => {
            const error = (body as { error?: unknown } | undefined)?.error
            reject(
              new Error(
                `Incus websocket ${path.split("?")[0]} failed (${response.statusCode}): ${typeof error === "string" ? error : "no upgrade"}`,
              ),
            )
          }, reject)
        })
        req.end()
      })
    },
    close() {
      pooled.destroy()
      single.destroy()
      for (const socket of upgraded) socket.destroy()
      upgraded.clear()
    },
  }
}
