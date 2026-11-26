import { readFileSync, writeFileSync } from "node:fs"
import { crc32, deflateSync } from "node:zlib"

const [inp, out] = process.argv.slice(2)
const b = readFileSync(inp)
const header = b
  .subarray(0, 64)
  .toString("latin1")
  .match(/^P6\s+(\d+)\s+(\d+)\s+(\d+)\s/)
const [, w, h] = header.map(Number)
const px = b.subarray(header[0].length)
const raw = Buffer.alloc((w * 3 + 1) * h)
for (let y = 0; y < h; y++) px.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3)
const chunk = (t, d) => {
  const l = Buffer.alloc(4)
  l.writeUInt32BE(d.length)
  const td = Buffer.concat([Buffer.from(t), d])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc32(td))
  return Buffer.concat([l, td, c])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(w, 0)
ihdr.writeUInt32BE(h, 4)
ihdr[8] = 8
ihdr[9] = 2
writeFileSync(
  out,
  Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
)
