import { createHash, X509Certificate } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { createServer as createHttpsServer } from "node:https"
import type { AddressInfo, Socket } from "node:net"
import type { TLSSocket } from "node:tls"
import { createSelfSignedIdentity } from "../../src/node/client-identity"
import { encodeFrame, FrameDecoder, websocketAccept } from "../../src/node/websocket"

export interface FakeIncus {
  readonly url: string
  readonly fingerprint: string
  readonly requests: string[]
  readonly trusted: Set<string>
  readonly uploads: number[]
  token(options?: { expiresAt?: string; addresses?: string[] }): string
  close(): Promise<void>
}

function reply(res: ServerResponse, status: number, body: unknown) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(text),
  })
  res.end(text)
}

const sync = (metadata: unknown) => ({
  type: "sync",
  status: "Success",
  status_code: 200,
  metadata,
})
const failure = (code: number, error: string) => ({ type: "error", error, error_code: code })

function peerFingerprint(req: IncomingMessage): string | undefined {
  const raw = (req.socket as TLSSocket).getPeerCertificate().raw
  return raw === undefined ? undefined : createHash("sha256").update(raw).digest("hex")
}

function echoWebsocket(req: IncomingMessage, socket: Socket, head: Buffer) {
  const key = req.headers["sec-websocket-key"]
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(String(key))}\r\n\r\n`,
  )
  const decoder = new FrameDecoder()
  const handle = (chunk: Buffer) => {
    for (const frame of decoder.push(chunk)) {
      if (frame.opcode === 0x8) {
        for (const part of encodeFrame(0x8, frame.payload, false)) socket.write(part)
        socket.end()
        return
      }
      for (const part of encodeFrame(0x2, frame.payload, false)) socket.write(part)
    }
  }
  socket.on("data", handle)
  if (head.length > 0) handle(head)
}

export async function startFakeIncus(): Promise<FakeIncus> {
  const identity = createSelfSignedIdentity({
    commonName: "fake-incus",
    now: new Date(),
    usage: "server",
  })
  const fingerprint = createHash("sha256")
    .update(new X509Certificate(identity.certificate).raw)
    .digest("hex")
  const requests: string[] = []
  const trusted = new Set<string>()
  const uploads: number[] = []
  const tokens = new Set<string>()

  const handler = (req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? ""
    requests.push(`${req.method} ${path}`)
    const client = peerFingerprint(req)
    const isTrusted = client !== undefined && trusted.has(client)
    const chunks: Buffer[] = []
    req.on("data", (chunk: Buffer) => chunks.push(chunk))
    req.on("end", () => {
      const body = Buffer.concat(chunks)
      if (req.method === "GET" && path === "/1.0") {
        return reply(
          res,
          200,
          sync({
            auth: isTrusted ? "trusted" : "untrusted",
            api_extensions: [],
            environment: isTrusted ? { server_version: "6.0.4", driver: "qemu" } : {},
          }),
        )
      }
      if (req.method === "POST" && path === "/1.0/certificates") {
        const token =
          (JSON.parse(body.toString("utf8")) as { trust_token?: string }).trust_token ?? ""
        if (!tokens.has(token) || client === undefined)
          return reply(res, 403, failure(403, "not authorized"))
        tokens.delete(token)
        trusted.add(client)
        return reply(res, 200, sync({}))
      }
      if (!isTrusted) return reply(res, 403, failure(403, "not authorized"))
      if (req.method === "POST" && path.startsWith("/1.0/images")) {
        uploads.push(body.length)
        return reply(res, 200, sync({}))
      }
      return reply(res, 404, failure(404, "not found"))
    })
  }

  const server = createHttpsServer(
    {
      cert: identity.certificate,
      key: identity.key,
      requestCert: true,
      rejectUnauthorized: false,
    },
    handler,
  )
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    requests.push(`WS ${req.url}`)
    echoWebsocket(req, socket, head)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const url = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    url,
    fingerprint,
    requests,
    trusted,
    uploads,
    token(tokenOptions = {}) {
      const text = Buffer.from(
        JSON.stringify({
          client_name: "dsh-bots-test",
          fingerprint,
          addresses: tokenOptions.addresses ?? [url.slice("https://".length)],
          secret: Math.random().toString(16).slice(2),
          expires_at: tokenOptions.expiresAt ?? "0001-01-01T00:00:00Z",
        }),
      ).toString("base64")
      tokens.add(text)
      return text
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.()
        server.close(() => resolve())
      }),
  }
}
