export interface TarEntry {
  readonly path: string
  readonly mode: number
  readonly content: Uint8Array
}

const BLOCK = 512

function field(header: Buffer, offset: number, length: number, value: string): void {
  const bytes = Buffer.from(value, "utf8")
  if (bytes.length > length) throw new Error(`"${value}" does not fit a tar header`)
  bytes.copy(header, offset)
}

const octal = (value: number, length: number) => `${value.toString(8).padStart(length - 1, "0")}\0`

function header(path: string, mode: number, size: number, type: "0" | "5"): Buffer {
  const block = Buffer.alloc(BLOCK)
  field(block, 0, 100, path)
  field(block, 100, 8, octal(mode, 8))
  field(block, 108, 8, octal(0, 8))
  field(block, 116, 8, octal(0, 8))
  field(block, 124, 12, octal(size, 12))
  field(block, 136, 12, octal(0, 12))
  block.fill(" ", 148, 156)
  field(block, 156, 1, type)
  field(block, 257, 6, "ustar\0")
  field(block, 263, 2, "00")
  let sum = 0
  for (const byte of block) sum += byte
  field(block, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `)
  return block
}

export function tarOf(entries: readonly TarEntry[]): Buffer {
  const parts: Buffer[] = []
  const dirs = new Set<string>()
  for (const entry of entries) {
    const segments = entry.path.split("/").slice(0, -1)
    for (let depth = 1; depth <= segments.length; depth++) {
      const dir = `${segments.slice(0, depth).join("/")}/`
      if (dirs.has(dir)) continue
      dirs.add(dir)
      parts.push(header(dir, 0o755, 0, "5"))
    }
    parts.push(header(entry.path, entry.mode, entry.content.length, "0"))
    parts.push(Buffer.from(entry.content))
    const padding = (BLOCK - (entry.content.length % BLOCK)) % BLOCK
    if (padding > 0) parts.push(Buffer.alloc(padding))
  }
  parts.push(Buffer.alloc(BLOCK * 2))
  return Buffer.concat(parts)
}
