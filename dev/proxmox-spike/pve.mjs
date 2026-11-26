import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import https from "node:https"

export function endpointFrom(
  file = process.env.PVE_ENDPOINT ?? "/var/tmp/pve-spike/endpoint.json",
) {
  const spec = JSON.parse(readFileSync(file, "utf8"))
  const url = new URL(spec.url)
  const pin = spec.fingerprint.toLowerCase().replaceAll(":", "")
  const checkServerIdentity = (_host, peer) => {
    const fp = createHash("sha256").update(peer.raw).digest("hex")
    return fp === pin ? undefined : new Error(`server certificate ${fp} does not match ${pin}`)
  }
  return {
    ...spec,
    host: url.hostname,
    port: Number(url.port || 8006),
    tls: { rejectUnauthorized: false, checkServerIdentity },
    agent: new https.Agent({ keepAlive: true, rejectUnauthorized: false, checkServerIdentity }),
  }
}

function auth(ep) {
  return { Authorization: `PVEAPIToken=${ep.token}` }
}

export function request(ep, method, path, params, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const isStream = params && typeof params.pipe === "function"
    let payload
    const headers = { ...auth(ep), ...extraHeaders }
    if (params !== undefined && !isStream) {
      payload = Buffer.from(JSON.stringify(params))
      headers["Content-Type"] = "application/json"
      headers["Content-Length"] = payload.length
    }
    const req = https.request(
      {
        host: ep.host,
        port: ep.port,
        method,
        path: `/api2/json${path}`,
        headers,
        agent: ep.agent,
        ...ep.tls,
      },
      (res) => {
        const chunks = []
        res.on("data", (c) => chunks.push(c))
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8")
          let body
          try {
            body = JSON.parse(text)
          } catch {
            body = text
          }
          resolve({ status: res.statusCode, message: res.statusMessage, body })
        })
      },
    )
    req.on("error", reject)
    if (isStream) params.pipe(req)
    else req.end(payload)
  })
}

export class PveError extends Error {}

export async function call(ep, method, path, params, headers) {
  const res = await request(ep, method, path, params, headers)
  if (res.status >= 400) {
    const detail = res.body?.errors ? ` ${JSON.stringify(res.body.errors)}` : ""
    const e = new PveError(`${method} ${path} -> ${res.status} ${res.message}${detail}`)
    e.status = res.status
    throw e
  }
  return res.body?.data
}

export async function waitTask(ep, node, upid, timeoutMs = 600000) {
  const end = Date.now() + timeoutMs
  for (;;) {
    const st = await call(ep, "GET", `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`)
    if (st.status === "stopped") {
      if (st.exitstatus !== "OK") {
        const log = await call(
          ep,
          "GET",
          `/nodes/${node}/tasks/${encodeURIComponent(upid)}/log?limit=50`,
        )
        throw new PveError(`task ${upid} ${st.exitstatus}: ${log.map((l) => l.t).join(" | ")}`)
      }
      return st
    }
    if (Date.now() > end) throw new PveError(`task ${upid} timed out`)
    await new Promise((r) => setTimeout(r, 300))
  }
}

export async function task(ep, node, method, path, params) {
  const upid = await call(ep, method, path, params)
  return typeof upid === "string" && upid.startsWith("UPID:") ? waitTask(ep, node, upid) : upid
}

export function websocket(ep, path, protocol = "binary") {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString("base64")
    const req = https.request({
      host: ep.host,
      port: ep.port,
      method: "GET",
      path: `/api2/json${path}`,
      agent: false,
      ...ep.tls,
      headers: {
        ...auth(ep),
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Key": key,
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Protocol": protocol,
      },
    })
    req.on("upgrade", (_res, socket, head) => resolve(new WebSocketConn(socket, head)))
    req.on("response", (res) =>
      reject(new PveError(`websocket ${path} -> HTTP ${res.statusCode} ${res.statusMessage}`)),
    )
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
      let len = b[1] & 0x7f
      let off = 2
      if (len === 126) {
        if (b.length < 4) return
        len = b.readUInt16BE(2)
        off = 4
      } else if (len === 127) {
        if (b.length < 10) return
        len = Number(b.readBigUInt64BE(2))
        off = 10
      }
      if (b.length < off + len) return
      const payload = b.subarray(off, off + len)
      this.buf = b.subarray(off + len)
      if (op === 0x8) {
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
    const m = mask.readUInt32LE(0)
    let i = 0
    for (; i + 4 <= len; i += 4) masked.writeUInt32LE((payload.readUInt32LE(i) ^ m) >>> 0, i)
    for (; i < len; i++) masked[i] = payload[i] ^ mask[i & 3]
    return this.socket.write(Buffer.concat([header, mask, masked]))
  }
  send(data) {
    return this.sendFrame(0x2, data)
  }
  close() {
    this.sendFrame(0x8, Buffer.from([0x03, 0xe8]))
  }
}
