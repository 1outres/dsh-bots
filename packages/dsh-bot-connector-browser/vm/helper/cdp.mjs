import { randomBytes } from "node:crypto"
import { connect } from "node:net"

const MAX_MESSAGE_BYTES = 64 << 20
const CALL_TIMEOUT_MS = 15_000
const encoder = new TextEncoder()

export class CdpError extends Error {
  constructor(message) {
    super(message)
    this.name = "CdpError"
  }
}

export function parseEndpoint(value) {
  const match = typeof value === "string" ? /^127\.0\.0\.1:([0-9]{2,5})$/.exec(value) : null
  if (match === null) throw new CdpError("the DevTools endpoint is not on loopback")
  return { host: "127.0.0.1", port: Number(match[1]) }
}

async function browserPath(endpoint) {
  const response = await fetch(`http://${endpoint.host}:${endpoint.port}/json/version`, {
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })
  const url = new URL((await response.json()).webSocketDebuggerUrl)
  if (
    url.protocol !== "ws:" ||
    url.hostname !== endpoint.host ||
    url.port !== String(endpoint.port)
  ) {
    throw new CdpError("DevTools answered with another endpoint")
  }
  if (!/^\/devtools\/browser\/[A-Za-z0-9-]+$/.test(url.pathname)) {
    throw new CdpError("DevTools answered with an unexpected browser path")
  }
  return url.pathname
}

function frameHeader(opcode, length) {
  if (length < 126) return Uint8Array.of(0x80 | opcode, 0x80 | length)
  if (length < 0x10000) return Uint8Array.of(0x80 | opcode, 0x80 | 126, length >> 8, length & 0xff)
  const header = new Uint8Array(10)
  header[0] = 0x80 | opcode
  header[1] = 0x80 | 127
  new DataView(header.buffer).setBigUint64(2, BigInt(length))
  return header
}

function writeFrame(socket, opcode, parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const header = frameHeader(opcode, length)
  const mask = randomBytes(4)
  const frame = Buffer.alloc(header.length + 4 + length)
  frame.set(header, 0)
  frame.set(mask, header.length)
  let at = header.length + 4
  let index = 0
  for (const part of parts) {
    for (const byte of part) frame[at++] = byte ^ mask[index++ & 3]
  }
  return new Promise((resolve, reject) => {
    socket.write(frame, (error) => {
      frame.fill(0)
      if (error) reject(new CdpError("DevTools connection failed"))
      else resolve()
    })
  })
}

function handshake(socket, path, endpoint) {
  const key = randomBytes(16).toString("base64")
  socket.write(
    `GET ${path} HTTP/1.1\r\nHost: ${endpoint.host}:${endpoint.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
  )
  return new Promise((resolve, reject) => {
    let head = Buffer.alloc(0)
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk])
      const end = head.indexOf("\r\n\r\n")
      if (end < 0) {
        if (head.length > 16_384) fail(new CdpError("DevTools sent an oversized handshake"))
        return
      }
      socket.off("data", onData)
      socket.off("error", fail)
      if (!/^HTTP\/1\.1 101 /.test(head.subarray(0, end).toString("latin1"))) {
        reject(new CdpError("DevTools refused the WebSocket"))
        return
      }
      resolve(head.subarray(end + 4))
    }
    const fail = (error) => {
      socket.off("data", onData)
      reject(error instanceof CdpError ? error : new CdpError("DevTools is not reachable"))
    }
    socket.on("data", onData)
    socket.on("error", fail)
  })
}

function frameReader(socket, onMessage, onClose) {
  let buffer = Buffer.alloc(0)
  let fragments = []
  return (chunk) => {
    buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk])
    for (;;) {
      if (buffer.length < 2) return
      const fin = (buffer[0] & 0x80) !== 0
      const opcode = buffer[0] & 0x0f
      let length = buffer[1] & 0x7f
      let offset = 2
      if (length === 126) {
        if (buffer.length < 4) return
        length = buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        if (buffer.length < 10) return
        length = Number(buffer.readBigUInt64BE(2))
        offset = 10
      }
      if ((buffer[1] & 0x80) !== 0 || length > MAX_MESSAGE_BYTES) {
        onClose(new CdpError("DevTools sent an invalid frame"))
        return
      }
      if (buffer.length < offset + length) return
      const payload = buffer.subarray(offset, offset + length)
      buffer = buffer.subarray(offset + length)
      if (opcode === 0x8) {
        onClose(new CdpError("DevTools closed the connection"))
        return
      }
      if (opcode === 0x9) {
        void writeFrame(socket, 0xa, [payload]).catch(() => {})
        continue
      }
      if (opcode === 0xa) continue
      if (opcode === 0x1 || opcode === 0x0) {
        fragments.push(payload)
        if (fragments.reduce((sum, part) => sum + part.length, 0) > MAX_MESSAGE_BYTES) {
          onClose(new CdpError("DevTools sent an oversized message"))
          return
        }
        if (fin) {
          const message = Buffer.concat(fragments)
          fragments = []
          onMessage(message)
        }
      }
    }
  }
}

export async function connectBrowser(endpoint) {
  const path = await browserPath(endpoint)
  const socket = connect(endpoint)
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", () => reject(new CdpError("DevTools is not reachable")))
  })
  const rest = await handshake(socket, path, endpoint)
  const pending = new Map()
  const listeners = new Set()
  let nextId = 1
  let failure
  let closedResolve
  const closed = new Promise((resolve) => {
    closedResolve = resolve
  })

  const close = (error) => {
    if (failure !== undefined) return
    failure = error
    for (const entry of pending.values()) entry.reject(error)
    pending.clear()
    socket.destroy()
    closedResolve(error)
  }

  const onMessage = (bytes) => {
    let message
    try {
      message = JSON.parse(bytes.toString("utf8"))
    } catch {
      close(new CdpError("DevTools sent a message that is not JSON"))
      return
    }
    if (typeof message.id === "number") {
      const entry = pending.get(message.id)
      if (entry === undefined) return
      pending.delete(message.id)
      if (message.error !== undefined) {
        entry.reject(
          new CdpError(`${entry.method}: ${String(message.error.message).slice(0, 200)}`),
        )
      } else {
        entry.resolve(message.result ?? {})
      }
      return
    }
    if (typeof message.method === "string") {
      for (const listener of listeners) listener(message)
    }
  }

  const read = frameReader(socket, onMessage, close)
  socket.on("data", read)
  socket.on("error", () => close(new CdpError("DevTools connection failed")))
  socket.on("close", () => close(new CdpError("DevTools connection ended")))
  if (rest.length > 0) read(rest)

  const send = async (method, sessionId, parts) => {
    if (failure !== undefined) throw failure
    const id = nextId++
    const answer = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new CdpError(`${method} timed out`))
      }, CALL_TIMEOUT_MS)
      pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
    })
    const head = encoder.encode(
      `{"id":${id},${sessionId === undefined ? "" : `"sessionId":${JSON.stringify(sessionId)},`}"method":${JSON.stringify(method)},"params":`,
    )
    await writeFrame(socket, 0x1, [head, ...parts, encoder.encode("}")])
    return answer
  }

  return {
    closed,
    call: (method, params = {}, sessionId) =>
      send(method, sessionId, [encoder.encode(JSON.stringify(params))]),
    callWithSecret: (method, before, secret, after, sessionId) =>
      send(method, sessionId, [encoder.encode(before), secret, encoder.encode(after)]),
    on(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close: () => close(new CdpError("closed")),
  }
}
