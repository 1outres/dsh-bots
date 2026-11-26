const SECTOR = 2048

function both16(buf, off, v) {
  buf.writeUInt16LE(v, off)
  buf.writeUInt16BE(v, off + 2)
}
function both32(buf, off, v) {
  buf.writeUInt32LE(v, off)
  buf.writeUInt32BE(v, off + 4)
}
function dirDate(buf, off, d) {
  buf[off] = d.getUTCFullYear() - 1900
  buf[off + 1] = d.getUTCMonth() + 1
  buf[off + 2] = d.getUTCDate()
  buf[off + 3] = d.getUTCHours()
  buf[off + 4] = d.getUTCMinutes()
  buf[off + 5] = d.getUTCSeconds()
  buf[off + 6] = 0
}
function volDate(buf, off, d) {
  const p = (n, w = 2) => String(n).padStart(w, "0")
  const s = `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}00`
  buf.write(s, off, "ascii")
  buf[off + 16] = 0
}
function record(name, extent, size, isDir, date) {
  const id = Buffer.from(name, "ascii")
  const len = 33 + id.length + (id.length % 2 === 0 ? 1 : 0)
  const r = Buffer.alloc(len)
  r[0] = len
  both32(r, 2, extent)
  both32(r, 10, size)
  dirDate(r, 18, date)
  r[25] = isDir ? 2 : 0
  both16(r, 28, 1)
  r[32] = id.length
  id.copy(r, 33)
  return r
}

export function nocloudIso(files, date = new Date()) {
  const entries = Object.entries(files).map(([name, text]) => ({
    id: `${name.toUpperCase()};1`,
    data: Buffer.from(text),
  }))
  entries.sort((a, b) => (a.id < b.id ? -1 : 1))
  const ROOT = 20
  let next = ROOT + 1
  for (const e of entries) {
    e.extent = next
    next += Math.max(1, Math.ceil(e.data.length / SECTOR))
  }
  const total = next
  const img = Buffer.alloc(total * SECTOR)
  const pvd = img.subarray(16 * SECTOR, 17 * SECTOR)
  pvd[0] = 1
  pvd.write("CD001", 1, "ascii")
  pvd[6] = 1
  pvd.fill(0x20, 8, 72)
  pvd.write("cidata", 40, "ascii")
  both32(pvd, 80, total)
  both16(pvd, 120, 1)
  both16(pvd, 124, 1)
  both16(pvd, 128, SECTOR)
  both32(pvd, 132, 10)
  pvd.writeUInt32LE(18, 140)
  pvd.writeUInt32BE(19, 148)
  record("\0", ROOT, SECTOR, true, date).copy(pvd, 156)
  pvd.fill(0x20, 190, 813)
  for (const off of [813, 830, 864]) volDate(pvd, off, date)
  pvd.fill(0x30, 847, 863)
  pvd[881] = 1
  const term = img.subarray(17 * SECTOR)
  term[0] = 255
  term.write("CD001", 1, "ascii")
  term[6] = 1
  const pt = (be) => {
    const r = Buffer.alloc(10)
    r[0] = 1
    if (be) r.writeUInt32BE(ROOT, 2)
    else r.writeUInt32LE(ROOT, 2)
    if (be) r.writeUInt16BE(1, 6)
    else r.writeUInt16LE(1, 6)
    return r
  }
  pt(false).copy(img, 18 * SECTOR)
  pt(true).copy(img, 19 * SECTOR)
  let off = ROOT * SECTOR
  for (const r of [
    record("\0", ROOT, SECTOR, true, date),
    record("\x01", ROOT, SECTOR, true, date),
    ...entries.map((e) => record(e.id, e.extent, e.data.length, false, date)),
  ]) {
    r.copy(img, off)
    off += r.length
  }
  for (const e of entries) e.data.copy(img, e.extent * SECTOR)
  return img
}
