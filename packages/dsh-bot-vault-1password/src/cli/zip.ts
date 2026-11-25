import { inflateRawSync } from "node:zlib"

/**
 * Takes one file out of a zip archive by its exact name: read from the
 * central directory, stored or deflated, its size bounded. Entry names are
 * only compared, never used as paths, so no entry can be written anywhere.
 */

export class ZipError extends Error {
  override readonly name = "ZipError"
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_HEADER = 0x02014b50
const LOCAL_HEADER = 0x04034b50
const MAX_COMMENT = 0xffff
const STORED = 0
const DEFLATED = 8
const ENCRYPTED = 1
const ZIP64 = 0xffffffff

function endOfCentralDirectory(view: DataView): number {
  const last = view.byteLength - 22
  for (let at = last; at >= 0 && at >= last - MAX_COMMENT; at--) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) return at
  }
  throw new ZipError("not a zip archive")
}

const sameName = (zip: Uint8Array, at: number, length: number, name: Uint8Array) =>
  length === name.length && name.every((byte, index) => zip[at + index] === byte)

/** @throws ZipError when the archive is malformed or has not exactly one such file. */
export function extractZipEntry(zip: Uint8Array, entry: string, maxBytes: number): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const name = new TextEncoder().encode(entry)
  const end = endOfCentralDirectory(view)
  const count = view.getUint16(end + 10, true)
  const directorySize = view.getUint32(end + 12, true)
  const directoryStart = view.getUint32(end + 16, true)
  if (directoryStart === ZIP64 || directoryStart + directorySize > end) {
    throw new ZipError("the zip's central directory is out of bounds")
  }
  let found: { method: number; compressed: number; size: number; local: number } | undefined
  let at = directoryStart
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || view.getUint32(at, true) !== CENTRAL_HEADER) {
      throw new ZipError("the zip's central directory is malformed")
    }
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    if (sameName(zip, at + 46, nameLength, name)) {
      if (found !== undefined) throw new ZipError(`the zip has ${entry} twice`)
      if ((view.getUint16(at + 8, true) & ENCRYPTED) !== 0) {
        throw new ZipError(`the zip's ${entry} is encrypted`)
      }
      found = {
        method: view.getUint16(at + 10, true),
        compressed: view.getUint32(at + 20, true),
        size: view.getUint32(at + 24, true),
        local: view.getUint32(at + 42, true),
      }
    }
    at += 46 + nameLength + extraLength + commentLength
  }
  if (found === undefined) throw new ZipError(`the zip has no ${entry}`)
  if (found.size > maxBytes || found.compressed === ZIP64 || found.size === ZIP64) {
    throw new ZipError(`the zip's ${entry} is larger than expected`)
  }
  const local = found.local
  if (local + 30 > directoryStart || view.getUint32(local, true) !== LOCAL_HEADER) {
    throw new ZipError("the zip's local header is malformed")
  }
  const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true)
  const dataEnd = dataStart + found.compressed
  if (dataEnd > directoryStart) throw new ZipError(`the zip's ${entry} is out of bounds`)
  const data = zip.subarray(dataStart, dataEnd)
  let out: Uint8Array
  if (found.method === STORED) {
    out = data.slice()
  } else if (found.method === DEFLATED) {
    try {
      out = new Uint8Array(inflateRawSync(data, { maxOutputLength: Math.max(found.size, 1) }))
    } catch {
      throw new ZipError(`the zip's ${entry} does not inflate`)
    }
  } else {
    throw new ZipError(`the zip's ${entry} uses an unsupported compression`)
  }
  if (out.length !== found.size) throw new ZipError(`the zip's ${entry} has the wrong size`)
  return out
}
