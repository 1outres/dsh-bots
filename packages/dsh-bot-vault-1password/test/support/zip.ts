import { deflateRawSync } from "node:zlib"

export interface ZipFile {
  readonly name: string
  readonly data: Uint8Array
  readonly method?: 0 | 8 | 12
  readonly flags?: number
  /** Overrides the size the central directory states. */
  readonly statedSize?: number
}

/** A small zip writer for tests (no CRC check is made by the reader; sizes are). */
export function makeZip(files: readonly ZipFile[]): Uint8Array {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const method = file.method ?? 8
    const name = Buffer.from(file.name)
    const body = method === 8 ? deflateRawSync(file.data) : Buffer.from(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(file.flags ?? 0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(798, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(file.flags ?? 0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(file.statedSize ?? file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, body)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return new Uint8Array(Buffer.concat([...locals, directory, end]))
}
