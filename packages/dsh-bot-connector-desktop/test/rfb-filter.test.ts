import { describe, expect, it } from "vitest"
import {
  MAX_CUT_TEXT_BYTES,
  RfbClientFilter,
  RfbProtocolError,
} from "../src/host/screen/rfb-filter"

const bytes = (...parts: (number[] | Uint8Array | string)[]) => {
  const flat: number[] = []
  for (const part of parts) {
    if (typeof part === "string") flat.push(...new TextEncoder().encode(part))
    else flat.push(...part)
  }
  return Uint8Array.from(flat)
}
const u16 = (value: number) => [value >> 8, value & 0xff]
const i32 = (value: number) => {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setInt32(0, value)
  return [...out]
}

const HANDSHAKE = bytes("RFB 003.008\n", [1], [0])
const key = (down: number, keysym: number) => bytes([4, down, 0, 0], i32(keysym))
const pointer = (mask: number, x: number, y: number) => bytes([5, mask], u16(x), u16(y))
const update = () => bytes([3, 1], u16(0), u16(0), u16(1280), u16(1024))
const pixelFormat = () => bytes([0, 0, 0, 0], new Array(16).fill(0))
const encodings = (...list: number[]) => bytes([2, 0], u16(list.length), ...list.map(i32))
const cutText = (text: string) => bytes([6, 0, 0, 0], i32(text.length), text)
const fence = (payload: number[]) => bytes([248, 0, 0, 0], i32(0), [payload.length], payload)
const continuous = () => bytes([150, 1], u16(0), u16(0), u16(10), u16(10))
const desktopSize = () => bytes([251, 0], u16(800), u16(600), [1, 0], new Array(16).fill(0))
const xvp = () => bytes([250, 0, 1, 2])
const qemuKey = () => bytes([255, 0], u16(1), i32(0x61), i32(30))

const ready = () => {
  const filter = new RfbClientFilter()
  filter.push(HANDSHAKE, false)
  return filter
}

const concat = (parts: Uint8Array[]) => bytes(...parts)

describe("RfbClientFilter", () => {
  it("passes the handshake with a shared ClientInit whatever the viewer asked", () => {
    const out = new RfbClientFilter().push(HANDSHAKE, false).forward
    expect([...out]).toEqual([...bytes("RFB 003.008\n", [1], [1])])
  })

  it("always passes what only asks for pictures, also while viewing", () => {
    const filter = ready()
    const stream = concat([pixelFormat(), update(), continuous(), fence([1, 2, 3])])
    const out = filter.push(stream, false)
    expect([...out.forward]).toEqual([...stream])
    expect(out.dropped).toBe(0)
  })

  it("drops every input message while viewing, framed across chunks of any size", () => {
    const messages = [
      key(1, 0x61),
      pointer(1, 10, 20),
      cutText("hi"),
      desktopSize(),
      xvp(),
      qemuKey(),
    ]
    for (const size of [1, 2, 3, 7, 64]) {
      const filter = ready()
      const stream = concat([update(), ...messages, update()])
      const forwarded: Uint8Array[] = []
      let dropped = 0
      for (let offset = 0; offset < stream.byteLength; offset += size) {
        const out = filter.push(stream.slice(offset, offset + size), false)
        forwarded.push(out.forward)
        dropped += out.dropped
      }
      expect([...concat(forwarded)]).toEqual([...concat([update(), update()])])
      expect(dropped).toBe(messages.length)
    }
  })

  it("passes input from the viewer in control and releases what it left held", () => {
    const filter = ready()
    const input = concat([key(1, 0x61), key(1, 0xffe1), key(0, 0x61), pointer(1, 10, 20)])
    const out = filter.push(input, true)
    expect(out.dropped).toBe(0)
    expect([...out.forward]).toEqual([...input])
    expect([...filter.releaseHeld()]).toEqual([...concat([key(0, 0xffe1), pointer(0, 10, 20)])])
    expect(filter.releaseHeld().byteLength).toBe(0)
  })

  it("takes ExtendedMouseButtons out of SetEncodings so pointer events keep six bytes", () => {
    expect([...ready().push(encodings(7, -316, -223), false).forward]).toEqual([
      ...encodings(7, -223),
    ])
  })

  it("fails closed on unknown messages, versions, security types and oversized clipboard text", () => {
    expect(() => ready().push(bytes([99]), false)).toThrow(RfbProtocolError)
    expect(() => ready().push(bytes([255, 1]), false)).toThrow(RfbProtocolError)
    expect(() => new RfbClientFilter().push(bytes("RFB 003.003\n"), false)).toThrow(
      /unsupported RFB version/,
    )
    expect(() => new RfbClientFilter().push(bytes("RFB 003.008\n", [2]), false)).toThrow(
      /security type 2/,
    )
    expect(() => ready().push(bytes([6, 0, 0, 0], i32(MAX_CUT_TEXT_BYTES + 1)), true)).toThrow(
      /clipboard text/,
    )
  })
})
