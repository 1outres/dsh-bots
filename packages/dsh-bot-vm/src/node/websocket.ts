/**
 * A minimal RFC 6455 websocket over an upgraded socket, as a {@link ByteChannel}:
 * every data frame's payload is bytes of one stream (message boundaries carry
 * no meaning for Incus' exec streams). Frames this side sends are masked when
 * it is the client.
 */
import { createHash, randomFillSync } from "node:crypto"
import type { Duplex } from "node:stream"
import type { ByteChannel } from "../host/incus"

const OP_CONTINUATION = 0x0
const OP_TEXT = 0x1
const OP_BINARY = 0x2
const OP_CLOSE = 0x8
const OP_PING = 0x9
const OP_PONG = 0xa
const NORMAL_CLOSURE = 1000
/** Unread bytes past which the socket is paused until the reader catches up. */
const HIGH_WATER = 1024 * 1024
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

export function websocketAccept(key: string): string {
  return createHash("sha1")
    .update(key + GUID)
    .digest("base64")
}

export interface Frame {
  readonly opcode: number
  readonly payload: Buffer
}

function applyMask(payload: Uint8Array, mask: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(payload.length)
  const m0 = mask[0] as number
  const m1 = mask[1] as number
  const m2 = mask[2] as number
  const m3 = mask[3] as number
  const length = payload.length
  let index = 0
  for (; index + 4 <= length; index += 4) {
    out[index] = (payload[index] as number) ^ m0
    out[index + 1] = (payload[index + 1] as number) ^ m1
    out[index + 2] = (payload[index + 2] as number) ^ m2
    out[index + 3] = (payload[index + 3] as number) ^ m3
  }
  for (; index < length; index++)
    out[index] = (payload[index] as number) ^ (mask[index & 3] as number)
  return out
}

/** One frame's header and payload; masked with a fresh key when `masked`. */
export function encodeFrame(
  opcode: number,
  payload: Uint8Array,
  masked: boolean,
): readonly Buffer[] {
  const length = payload.length
  const extra = length < 126 ? 0 : length < 65_536 ? 2 : 8
  const header = Buffer.allocUnsafe(2 + extra + (masked ? 4 : 0))
  header[0] = 0x80 | opcode
  header[1] = (masked ? 0x80 : 0) | (extra === 0 ? length : extra === 2 ? 126 : 127)
  if (extra === 2) header.writeUInt16BE(length, 2)
  if (extra === 8) header.writeBigUInt64BE(BigInt(length), 2)
  if (!masked) return [header, Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)]
  const mask = header.subarray(2 + extra)
  randomFillSync(mask)
  return [header, applyMask(payload, mask)]
}

/** Splits a byte stream into frames, unmasking as needed. */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0)

  push(chunk: Buffer): readonly Frame[] {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    const frames: Frame[] = []
    for (;;) {
      const frame = this.next()
      if (frame === undefined) return frames
      frames.push(frame)
    }
  }

  private next(): Frame | undefined {
    const bytes = this.buffer
    if (bytes.length < 2) return undefined
    const opcode = (bytes[0] as number) & 0x0f
    const masked = ((bytes[1] as number) & 0x80) !== 0
    let length = (bytes[1] as number) & 0x7f
    let offset = 2
    if (length === 126) {
      if (bytes.length < 4) return undefined
      length = bytes.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (bytes.length < 10) return undefined
      const big = bytes.readBigUInt64BE(2)
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("websocket frame too large")
      length = Number(big)
      offset = 10
    }
    const maskOffset = offset
    if (masked) offset += 4
    if (bytes.length < offset + length) return undefined
    const raw = bytes.subarray(offset, offset + length)
    const payload = masked ? applyMask(raw, bytes.subarray(maskOffset, maskOffset + 4)) : raw
    this.buffer = bytes.subarray(offset + length)
    return { opcode, payload }
  }
}

/**
 * The channel over an upgraded socket. `head` is what arrived with the
 * upgrade response. `masked`: this side is the client.
 */
export function websocketChannel(socket: Duplex, head: Buffer, masked: boolean): ByteChannel {
  const decoder = new FrameDecoder()
  const queue: Buffer[] = []
  let queued = 0
  let ended = false
  let failure: Error | undefined
  let sentClose = false
  let wake: (() => void) | undefined

  const notify = () => {
    const resume = wake
    wake = undefined
    resume?.()
  }
  const finish = (error?: Error) => {
    if (ended) return
    ended = true
    failure = error
    notify()
  }
  const send = (opcode: number, payload: Uint8Array): Promise<void> => {
    if (socket.destroyed || socket.writableEnded) {
      return Promise.reject(failure ?? new Error("the websocket is closed"))
    }
    const [header, body] = encodeFrame(opcode, payload, masked) as [Buffer, Buffer]
    socket.cork()
    socket.write(header)
    const flushed = socket.write(body)
    socket.uncork()
    if (flushed) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const done = (error?: Error) => {
        socket.off("drain", drained)
        socket.off("close", closed)
        if (error === undefined) resolve()
        else reject(error)
      }
      const drained = () => done()
      const closed = () => done(failure ?? new Error("the websocket closed"))
      socket.once("drain", drained)
      socket.once("close", closed)
    })
  }
  const sendClose = () => {
    if (sentClose) return Promise.resolve()
    sentClose = true
    const code = Buffer.allocUnsafe(2)
    code.writeUInt16BE(NORMAL_CLOSURE)
    return send(OP_CLOSE, code)
  }
  const receive = (chunk: Buffer) => {
    let frames: readonly Frame[]
    try {
      frames = decoder.push(chunk)
    } catch (error) {
      socket.destroy(error as Error)
      return
    }
    for (const frame of frames) {
      switch (frame.opcode) {
        case OP_BINARY:
        case OP_TEXT:
        case OP_CONTINUATION:
          if (frame.payload.length > 0 && !ended) {
            queue.push(frame.payload)
            queued += frame.payload.length
          }
          break
        case OP_PING:
          void send(OP_PONG, frame.payload).catch(() => {})
          break
        case OP_CLOSE:
          void sendClose()
            .catch(() => {})
            .finally(() => socket.end())
          finish()
          break
        default:
          break
      }
    }
    if (queued > HIGH_WATER) socket.pause()
    notify()
  }

  socket.on("data", receive)
  socket.once("end", () => finish())
  socket.once("close", () => finish())
  socket.on("error", (error: Error) => finish(error))
  if (head.length > 0) receive(head)

  return {
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = queue.shift()
        if (next !== undefined) {
          queued -= next.length
          if (queued <= HIGH_WATER && socket.isPaused()) socket.resume()
          yield next
          continue
        }
        if (ended) {
          if (failure !== undefined) throw failure
          return
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    },
    write: (data) => send(OP_BINARY, data),
    end: () => sendClose(),
    destroy(error) {
      finish(error)
      socket.destroy()
    },
  }
}
