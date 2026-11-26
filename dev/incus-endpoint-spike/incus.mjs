import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import http from "node:http"
import https from "node:https"

export function endpointFrom(spec) {
  if (spec.kind === "local") return { ...spec, agent: new http.Agent({ socketPath: spec.socket }) }
  const cert = readFileSync(spec.cert)
  const key = readFileSync(spec.key)
  const pin = spec.serverFingerprint.toLowerCase()
  const url = new URL(spec.url)
  const checkServerIdentity = (_host, peer) => {
    const fp = createHash("sha256").update(peer.raw).digest("hex")
    return fp === pin
      ? undefined
      : new Error(`server certificate ${fp} does not match pinned ${pin}`)
  }
  const agent = new https.Agent({
    cert,
    key,
    rejectUnauthorized: false,
    keepAlive: true,
    maxCachedSessions: 0,
    checkServerIdentity,
  })
  return {
    ...spec,
    agent,
    host: url.hostname,
    port: Number(url.port || 8443),
    pin,
    checkServerIdentity,
  }
}

function options(endpoint, method, path, headers) {
  const base = { method, path, headers: { Host: "incus", ...headers }, agent: endpoint.agent }
  if (endpoint.kind === "local") return { ...base, socketPath: endpoint.socket }
  return {
    ...base,
    host: endpoint.host,
    port: endpoint.port,
    cert: readFileSync(endpoint.cert),
    key: readFileSync(endpoint.key),
    rejectUnauthorized: false,
    checkServerIdentity: endpoint.checkServerIdentity,
  }
}

export function withProject(endpoint, path) {
  if (!endpoint.project) return path
  return `${path + (path.includes("?") ? "&" : "?")}project=${encodeURIComponent(endpoint.project)}`
}

export function request(endpoint, method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const isStream = body && typeof body.pipe === "function"
    const payload = body === undefined || isStream ? undefined : Buffer.from(JSON.stringify(body))
    const headers = { ...extraHeaders }
    if (payload) {
      headers["Content-Type"] = "application/json"
      headers["Content-Length"] = payload.length
    }
    const lib = endpoint.kind === "local" ? http : https
    const req = lib.request(
      options(endpoint, method, withProject(endpoint, path), headers),
      (res) => {
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8")
          let json
          try {
            json = JSON.parse(text)
          } catch {
            json = text
          }
          resolve({ status: res.statusCode, body: json })
        })
      },
    )
    req.on("error", reject)
    if (isStream) body.pipe(req)
    else req.end(payload)
  })
}

export async function call(endpoint, method, path, body, headers) {
  const res = await request(endpoint, method, path, body, headers)
  if (res.status >= 400 || res.body?.type === "error") {
    const e = new Error(
      method +
        " " +
        path +
        " -> " +
        res.status +
        ": " +
        (res.body?.error ?? JSON.stringify(res.body)),
    )
    e.status = res.status
    throw e
  }
  return res.body
}

export async function waitOp(endpoint, envelope, timeout = 600) {
  if (envelope.type !== "async") return envelope
  const op = envelope.operation
  const res = await call(endpoint, "GET", `${op}/wait?timeout=${timeout}`)
  const md = res.metadata
  if (md.status !== "Success") throw new Error(`operation ${op} ${md.status}: ${md.err}`)
  return md
}

export function websocket(endpoint, path) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64")
    const lib = endpoint.kind === "local" ? http : https
    const opts = options(endpoint, "GET", path, {
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Key": key,
      "Sec-WebSocket-Version": "13",
    })
    opts.agent = false
    const req = lib.request(opts)
    req.on("upgrade", (_res, socket, head) => {
      resolve(new WebSocketConn(socket, head))
    })
    req.on("response", (res) => reject(new Error(`websocket ${path} -> HTTP ${res.statusCode}`)))
    req.on("error", reject)
    req.end()
  })
}

export class WebSocketConn {
  constructor(socket, head) {
    this.socket = socket
    this.buf = head?.length ? Buffer.from(head) : Buffer.alloc(0)
    this.onmessage = () => {}
    this.onclose = () => {}
    this.closed = false
    socket.setNoDelay(true)
    socket.on("data", (d) => {
      this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d
      this.parse()
    })
    socket.on("close", () => this.finish())
    socket.on("error", () => this.finish())
    if (this.buf.length) queueMicrotask(() => this.parse())
  }
  finish() {
    if (!this.closed) {
      this.closed = true
      this.onclose()
    }
  }
  parse() {
    for (;;) {
      const b = this.buf
      if (b.length < 2) return
      const op = b[0] & 0x0f
      let len = b[1] & 0x7f,
        off = 2
      if (len === 126) {
        if (b.length < 4) return
        len = b.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (b.length < 10) return
        len = Number(b.readBigUInt64BE(2))
        off = 10
      }
      const masked = (b[1] & 0x80) !== 0
      let mask
      if (masked) {
        if (b.length < off + 4) return
        mask = b.subarray(off, off + 4)
        off += 4
      }
      if (b.length < off + len) return
      let payload = b.subarray(off, off + len)
      if (masked) {
        payload = Buffer.from(payload)
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
      }
      this.buf = b.subarray(off + len)
      if (op === 0x8) {
        this.sendFrame(0x8, Buffer.alloc(0))
        this.socket.end()
        this.finish()
        return
      }
      if (op === 0x9) {
        this.sendFrame(0xa, payload)
        continue
      }
      if (op === 0xa) continue
      this.onmessage(payload, op)
    }
  }
  sendFrame(op, payload) {
    if (this.socket.destroyed || this.socket.writableEnded) return true
    const len = payload.length
    let header
    if (len < 126) {
      header = Buffer.alloc(2)
      header[1] = 0x80 | len
    } else if (len < 65536) {
      header = Buffer.alloc(4)
      header[1] = 0x80 | 126
      header.writeUInt16BE(len, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 0x80 | 127
      header.writeBigUInt64BE(BigInt(len), 2)
    }
    header[0] = 0x80 | op
    const mask = randomBytes(4)
    const masked = Buffer.allocUnsafe(len)
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3]
    return this.socket.write(Buffer.concat([header, mask, masked]))
  }
  send(data) {
    return this.sendFrame(0x2, data)
  }
  close() {
    this.sendFrame(0x8, Buffer.from([0x03, 0xe8]))
  }
}
