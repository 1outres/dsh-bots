import { createHash, randomBytes } from "node:crypto"
import type { ClientRequest, IncomingMessage } from "node:http"
import { Agent, request } from "node:https"
import { isIP } from "node:net"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { type TLSSocket, connect as tlsConnect } from "node:tls"
import {
  ProxmoxCertificateError,
  type ProxmoxFile,
  type ProxmoxParams,
  type ProxmoxResponse,
  type ProxmoxTransport,
} from "../host/backend/proxmox/client"
import type { ProxmoxEndpoint } from "../host/backend/proxmox/endpoint"

const API = "/api2/json"
const PROBE_TIMEOUT_MS = 10_000

export interface ProxmoxProbe {
  readonly serverCertificateSha256: string
  readonly sourceAddress: string
}

export interface ClosableProxmoxTransport extends ProxmoxTransport {
  close(): void
}

function targetOf(url: string) {
  const parsed = new URL(url)
  const host = parsed.hostname.replace(/^\[|\]$/g, "")
  return { host, port: Number(parsed.port === "" ? 8006 : parsed.port) }
}

const certificateSha256 = (socket: TLSSocket) => {
  const raw = socket.getPeerCertificate().raw as Buffer | undefined
  return raw === undefined ? "(none)" : createHash("sha256").update(raw).digest("hex")
}

export function probeProxmox(url: string, signal?: AbortSignal): Promise<ProxmoxProbe> {
  const { host, port } = targetOf(url)
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()
    const socket = tlsConnect({
      host,
      port,
      ...(isIP(host) === 0 ? { servername: host } : {}),
      rejectUnauthorized: false,
      minVersion: "TLSv1.2",
    })
    const finish = (error?: Error, probe?: ProxmoxProbe) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", aborted)
      socket.destroy()
      if (probe !== undefined) resolve(probe)
      else reject(error)
    }
    const aborted = () =>
      finish(signal?.reason instanceof Error ? signal.reason : new Error("aborted"))
    const timer = setTimeout(
      () => finish(new Error(`${url} did not answer within ${PROBE_TIMEOUT_MS / 1000} seconds`)),
      PROBE_TIMEOUT_MS,
    )
    signal?.addEventListener("abort", aborted, { once: true })
    socket.once("error", (error) => finish(new Error(`${url}: ${error.message}`, { cause: error })))
    socket.once("secureConnect", () =>
      finish(undefined, {
        serverCertificateSha256: certificateSha256(socket),
        sourceAddress: socket.localAddress ?? "",
      }),
    )
  })
}

function pinnedAgent(endpoint: ProxmoxEndpoint): Agent {
  const { host, port } = targetOf(endpoint.url)
  const agent = new Agent({ keepAlive: true, maxSockets: 8 })
  Object.assign(agent, {
    createConnection: (
      _options: unknown,
      callback: (error: Error | null, socket?: TLSSocket) => void,
    ) => {
      const socket = tlsConnect({
        host,
        port,
        ...(isIP(host) === 0 ? { servername: host } : {}),
        rejectUnauthorized: false,
        minVersion: "TLSv1.2",
      })
      const failed = (error: Error) => {
        socket.destroy()
        callback(new Error(`Proxmox at ${endpoint.url}: ${error.message}`, { cause: error }))
      }
      socket.once("error", failed)
      socket.once("secureConnect", () => {
        socket.off("error", failed)
        const actual = certificateSha256(socket)
        if (actual !== endpoint.serverCertificateSha256) {
          socket.destroy()
          callback(
            new ProxmoxCertificateError(endpoint.url, endpoint.serverCertificateSha256, actual),
          )
          return
        }
        callback(null, socket)
      })
      return undefined
    },
  })
  return agent
}

async function responseOf(response: IncomingMessage): Promise<ProxmoxResponse> {
  const chunks: Buffer[] = []
  for await (const chunk of response) chunks.push(chunk as Buffer)
  const text = Buffer.concat(chunks).toString("utf8")
  let body: unknown
  try {
    body = text === "" ? undefined : JSON.parse(text)
  } catch {
    body = text
  }
  return { status: response.statusCode ?? 0, statusText: response.statusMessage ?? "", body }
}

const queryOf = (params: ProxmoxParams | undefined) => {
  if (params === undefined) return ""
  const query = new URLSearchParams(
    Object.entries(params).map(([key, value]) => [key, String(value)]),
  )
  const text = query.toString()
  return text === "" ? "" : `?${text}`
}

export function createProxmoxTransport(endpoint: ProxmoxEndpoint): ClosableProxmoxTransport {
  const agent = pinnedAgent(endpoint)
  const authorization = `PVEAPIToken=${endpoint.tokenId}=${endpoint.tokenSecret}`

  const exchange = (
    method: string,
    path: string,
    headers: Readonly<Record<string, string | number>>,
    signal: AbortSignal,
    send: (req: ClientRequest) => Promise<void>,
  ) =>
    new Promise<ProxmoxResponse>((resolve, reject) => {
      const req = request({
        agent,
        method,
        path,
        signal,
        headers: { Authorization: authorization, ...headers },
      })
      req.once("error", reject)
      req.once("response", (response) => {
        responseOf(response).then(resolve, reject)
      })
      send(req).catch((error: unknown) => {
        req.destroy(error as Error)
        reject(error)
      })
    })

  return {
    request(method, path, params, signal) {
      if (method === "GET" || method === "DELETE") {
        return exchange(method, `${API}${path}${queryOf(params)}`, {}, signal, async (req) => {
          req.end()
        })
      }
      const payload = Buffer.from(JSON.stringify(params ?? {}))
      return exchange(
        method,
        `${API}${path}`,
        { "Content-Type": "application/json", "Content-Length": payload.length },
        signal,
        async (req) => {
          req.end(payload)
        },
      )
    },
    upload(path, fields, file: ProxmoxFile, signal) {
      const boundary = `----dsh-bots-${randomBytes(12).toString("hex")}`
      const head = Buffer.from(
        [
          ...Object.entries(fields).map(
            ([name, value]) =>
              `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${String(value)}\r\n`,
          ),
          `--${boundary}\r\nContent-Disposition: form-data; name="filename"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ].join(""),
      )
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
      async function* body(): AsyncIterable<Uint8Array> {
        yield head
        let sent = 0
        for await (const chunk of file.body) {
          sent += chunk.length
          yield chunk
        }
        if (sent !== file.bytes)
          throw new Error(`${file.name} had ${sent} bytes, not ${file.bytes}`)
        yield tail
      }
      return exchange(
        "POST",
        `${API}${path}`,
        {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": head.length + file.bytes + tail.length,
        },
        signal,
        async (req) => {
          await pipeline(Readable.from(body()), req)
        },
      )
    },
    close() {
      agent.destroy()
    },
  }
}
