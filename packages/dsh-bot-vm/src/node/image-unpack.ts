import { createHash } from "node:crypto"
import { Readable } from "node:stream"
import { createZstdDecompress } from "node:zlib"
import type { UnpackedImage } from "../host/backend/proxmox/images"

const BLOCK = 512
const ROOTFS = "rootfs.img"
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

function nameOf(header: Buffer): string {
  const text = (from: number, to: number) =>
    header.subarray(from, to).toString("utf8").replace(/\0.*$/s, "")
  const name = text(0, 100)
  const prefix = header.subarray(257, 262).toString("latin1") === "ustar" ? text(345, 500) : ""
  return (prefix === "" ? name : `${prefix}/${name}`).replace(/^\.\//, "")
}

function sizeOf(header: Buffer): number {
  const field = header.subarray(124, 136)
  if (((field[0] as number) & 0x80) !== 0) {
    let value = 0
    for (let index = 1; index < field.length; index++)
      value = value * 256 + (field[index] as number)
    return value
  }
  const text = field.toString("latin1").replace(/\0.*$/s, "").trim()
  const value = text === "" ? 0 : Number.parseInt(text, 8)
  if (!Number.isSafeInteger(value))
    throw new Error("the image tarball has an unreadable entry size")
  return value
}

const padding = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK

export function unpackImage(tarball: AsyncIterable<Uint8Array>): UnpackedImage {
  const hash = createHash("sha256")
  let checkedMagic = false
  async function* hashed(): AsyncIterable<Uint8Array> {
    for await (const chunk of tarball) {
      if (!checkedMagic) {
        checkedMagic = true
        if (!ZSTD_MAGIC.every((byte, index) => chunk[index] === byte)) {
          throw new Error("the base image tarball is not zstd-compressed")
        }
      }
      hash.update(chunk)
      yield chunk
    }
  }
  const plain = Readable.from(hashed()).pipe(createZstdDecompress())
  const reader = plain[Symbol.asyncIterator]() as AsyncIterator<Buffer>
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0)

  async function more(): Promise<boolean> {
    const next = await reader.next()
    if (next.done) return false
    buffer = buffer.length === 0 ? next.value : Buffer.concat([buffer, next.value])
    return true
  }

  async function take(length: number): Promise<Buffer | undefined> {
    while (buffer.length < length) if (!(await more())) return undefined
    const taken = buffer.subarray(0, length)
    buffer = buffer.subarray(length)
    return taken
  }

  async function skip(length: number): Promise<void> {
    let left = length
    while (left > 0) {
      if (buffer.length === 0 && !(await more()))
        throw new Error("the image tarball ends inside an entry")
      const step = Math.min(left, buffer.length)
      buffer = buffer.subarray(step)
      left -= step
    }
  }

  async function drain(): Promise<string> {
    buffer = Buffer.alloc(0)
    while (!(await reader.next()).done) {}
    return hash.digest("hex")
  }

  let settleFingerprint: { resolve(value: string): void; reject(error: unknown): void } | undefined
  const fingerprint = new Promise<string>((resolve, reject) => {
    settleFingerprint = { resolve, reject }
  })
  const settled = settleFingerprint as NonNullable<typeof settleFingerprint>

  async function* content(size: number): AsyncIterable<Uint8Array> {
    let left = size
    let complete = false
    try {
      while (left > 0) {
        if (buffer.length === 0 && !(await more()))
          throw new Error(`the image tarball ends inside ${ROOTFS}`)
        const step = Math.min(left, buffer.length)
        const piece = buffer.subarray(0, step)
        buffer = buffer.subarray(step)
        left -= step
        yield piece
      }
      await skip(padding(size))
      settled.resolve(await drain())
      complete = true
    } catch (error) {
      settled.reject(error)
      throw error
    } finally {
      if (!complete) {
        plain.destroy()
        settled.reject(new Error(`reading ${ROOTFS} stopped early`))
      }
    }
  }

  async function find(): Promise<{
    readonly bytes: number
    readonly body: AsyncIterable<Uint8Array>
  }> {
    for (;;) {
      const header = await take(BLOCK)
      if (header === undefined || header.every((byte) => byte === 0)) {
        throw new Error(`the base image tarball has no ${ROOTFS}`)
      }
      const size = sizeOf(header)
      const type = String.fromCharCode(header[156] as number)
      if ((type === "0" || type === "\0") && nameOf(header) === ROOTFS)
        return { bytes: size, body: content(size) }
      await skip(size + padding(size))
    }
  }

  const rootfs = find()
  rootfs.catch((error: unknown) => {
    plain.destroy()
    settled.reject(error)
  })
  return { rootfs, fingerprint }
}
