export type InputKind = "key" | "pointer" | "cutText" | "desktopSize" | "qemuKey" | "xvp"

export interface FilterResult {
  readonly forward: Uint8Array
  readonly dropped: number
}

export class RfbProtocolError extends Error {
  override readonly name = "RfbProtocolError"
}

export const MAX_CUT_TEXT_BYTES = 128 * 1024

const VERSION = "RFB 003.008\n"
const SECURITY_NONE = 1
const EXTENDED_MOUSE_BUTTONS = -316

const MESSAGE = {
  setPixelFormat: 0,
  setEncodings: 2,
  updateRequest: 3,
  key: 4,
  pointer: 5,
  cutText: 6,
  enableContinuousUpdates: 150,
  fence: 248,
  xvp: 250,
  setDesktopSize: 251,
  qemu: 255,
} as const

type Phase = "version" | "security" | "clientInit" | "messages"

interface Framed {
  readonly length: number
  readonly input?: InputKind
}

const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.byteLength
  }
  return out
}

function frame(buffer: Uint8Array): Framed | undefined {
  const fixed = (length: number, input?: InputKind): Framed | undefined =>
    buffer.byteLength >= length ? { length, ...(input === undefined ? {} : { input }) } : undefined
  const data = view(buffer)
  switch (buffer[0]) {
    case MESSAGE.setPixelFormat:
      return fixed(20)
    case MESSAGE.setEncodings:
      return buffer.byteLength < 4 ? undefined : fixed(4 + 4 * data.getUint16(2))
    case MESSAGE.updateRequest:
      return fixed(10)
    case MESSAGE.key:
      return fixed(8, "key")
    case MESSAGE.pointer:
      return fixed(6, "pointer")
    case MESSAGE.cutText: {
      if (buffer.byteLength < 8) return undefined
      const length = Math.abs(data.getInt32(4))
      if (length > MAX_CUT_TEXT_BYTES) {
        throw new RfbProtocolError(
          `clipboard text of ${length} bytes is over ${MAX_CUT_TEXT_BYTES}`,
        )
      }
      return fixed(8 + length, "cutText")
    }
    case MESSAGE.enableContinuousUpdates:
      return fixed(10)
    case MESSAGE.fence:
      return buffer.byteLength < 9 ? undefined : fixed(9 + (buffer[8] ?? 0))
    case MESSAGE.xvp:
      return fixed(4, "xvp")
    case MESSAGE.setDesktopSize:
      return buffer.byteLength < 8 ? undefined : fixed(8 + 16 * (buffer[6] ?? 0), "desktopSize")
    case MESSAGE.qemu:
      if (buffer.byteLength < 2) return undefined
      if (buffer[1] !== 0) throw new RfbProtocolError(`unsupported QEMU message ${buffer[1]}`)
      return fixed(12, "qemuKey")
    default:
      throw new RfbProtocolError(`unsupported client message type ${buffer[0]}`)
  }
}

function withoutExtendedMouse(message: Uint8Array): Uint8Array {
  const data = view(message)
  const count = data.getUint16(2)
  const kept: number[] = []
  for (let index = 0; index < count; index += 1) {
    const encoding = data.getInt32(4 + 4 * index)
    if (encoding !== EXTENDED_MOUSE_BUTTONS) kept.push(encoding)
  }
  const out = new Uint8Array(4 + 4 * kept.length)
  const written = view(out)
  out[0] = MESSAGE.setEncodings
  written.setUint16(2, kept.length)
  for (const [index, encoding] of kept.entries()) written.setInt32(4 + 4 * index, encoding)
  return out
}

function keyEvent(down: boolean, keysym: number): Uint8Array {
  const out = new Uint8Array(8)
  out[0] = MESSAGE.key
  out[1] = down ? 1 : 0
  view(out).setUint32(4, keysym)
  return out
}

function pointerEvent(mask: number, x: number, y: number): Uint8Array {
  const out = new Uint8Array(6)
  const data = view(out)
  out[0] = MESSAGE.pointer
  out[1] = mask
  data.setUint16(2, x)
  data.setUint16(4, y)
  return out
}

export class RfbClientFilter {
  private phase: Phase = "version"
  private pending: Uint8Array = new Uint8Array(0)
  private readonly keys = new Set<number>()
  private pointer = { mask: 0, x: 0, y: 0 }

  push(chunk: Uint8Array, allowInput: boolean): FilterResult {
    this.pending = this.pending.byteLength === 0 ? chunk : concat([this.pending, chunk])
    const forward: Uint8Array[] = []
    let dropped = 0
    for (let message = this.next(); message !== undefined; message = this.next()) {
      if (message.input === undefined) {
        forward.push(message.bytes)
      } else if (allowInput) {
        this.track(message.bytes)
        forward.push(message.bytes)
      } else {
        dropped += 1
      }
    }
    return { forward: concat(forward), dropped }
  }

  releaseHeld(): Uint8Array {
    const out = [...this.keys].map((keysym) => keyEvent(false, keysym))
    this.keys.clear()
    if (this.pointer.mask !== 0) {
      out.push(pointerEvent(0, this.pointer.x, this.pointer.y))
      this.pointer = { ...this.pointer, mask: 0 }
    }
    return concat(out)
  }

  private take(length: number): Uint8Array {
    const head = this.pending.slice(0, length)
    this.pending = this.pending.subarray(length)
    return head
  }

  private next(): { readonly bytes: Uint8Array; readonly input?: InputKind } | undefined {
    switch (this.phase) {
      case "version": {
        if (this.pending.byteLength < VERSION.length) return undefined
        const version = new TextDecoder("latin1").decode(this.pending.subarray(0, VERSION.length))
        if (version !== VERSION) {
          throw new RfbProtocolError(`unsupported RFB version ${JSON.stringify(version)}`)
        }
        this.phase = "security"
        return { bytes: this.take(VERSION.length) }
      }
      case "security": {
        if (this.pending.byteLength < 1) return undefined
        if (this.pending[0] !== SECURITY_NONE) {
          throw new RfbProtocolError(`unsupported security type ${this.pending[0]}`)
        }
        this.phase = "clientInit"
        return { bytes: this.take(1) }
      }
      case "clientInit": {
        if (this.pending.byteLength < 1) return undefined
        this.take(1)
        this.phase = "messages"
        return { bytes: Uint8Array.of(1) }
      }
      case "messages": {
        if (this.pending.byteLength === 0) return undefined
        const framed = frame(this.pending)
        if (framed === undefined) return undefined
        const bytes = this.take(framed.length)
        if (bytes[0] === MESSAGE.setEncodings) return { bytes: withoutExtendedMouse(bytes) }
        return { bytes, ...(framed.input === undefined ? {} : { input: framed.input }) }
      }
    }
  }

  private track(message: Uint8Array): void {
    const data = view(message)
    if (message[0] === MESSAGE.key) {
      const keysym = data.getUint32(4)
      if (message[1] === 1) this.keys.add(keysym)
      else this.keys.delete(keysym)
    } else if (message[0] === MESSAGE.pointer) {
      this.pointer = { mask: message[1] ?? 0, x: data.getUint16(2), y: data.getUint16(4) }
    }
  }
}
