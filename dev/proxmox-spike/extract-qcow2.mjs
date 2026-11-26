import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { Writable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createZstdDecompress } from "node:zlib"

const [input, output] = process.argv.slice(2)
const out = createWriteStream(output)
const hash = createHash("sha256")
let buf = Buffer.alloc(0),
  remaining = 0,
  skip = 0,
  target = false,
  done = false,
  written = 0
const sink = new Writable({
  async write(chunk, _enc, cb) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk
    try {
      while (buf.length && !done) {
        if (remaining > 0) {
          const n = Math.min(remaining, buf.length)
          if (target) {
            const part = buf.subarray(0, n)
            hash.update(part)
            written += n
            if (!out.write(part)) await new Promise((r) => out.once("drain", r))
          }
          remaining -= n
          buf = buf.subarray(n)
          if (remaining === 0 && target) done = true
          continue
        }
        if (skip > 0) {
          const n = Math.min(skip, buf.length)
          skip -= n
          buf = buf.subarray(n)
          continue
        }
        if (buf.length < 512) break
        const h = buf.subarray(0, 512)
        buf = buf.subarray(512)
        if (h.every((b) => b === 0)) continue
        const name = h.subarray(0, 100).toString().replace(/\0.*$/s, "")
        const size = parseInt(h.subarray(124, 136).toString().replace(/\0.*$/s, "").trim(), 8) || 0
        target = name.replace(/^\.\//, "") === "rootfs.img"
        remaining = size
        skip = (512 - (size % 512)) % 512
        if (!target) {
          skip += size
          remaining = 0
        }
      }
      cb()
    } catch (e) {
      cb(e)
    }
  },
})
const t0 = Date.now()
await pipeline(createReadStream(input), createZstdDecompress(), sink).catch((e) => {
  if (!done) throw e
})
await new Promise((r) => out.end(r))
console.log("rootfs.img", written, "bytes", hash.digest("hex"), Date.now() - t0, "ms")
