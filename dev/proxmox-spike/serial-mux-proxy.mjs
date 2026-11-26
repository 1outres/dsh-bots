import net from "node:net"
import { call, endpointFrom, websocket } from "./pve.mjs"

const [mode, a, b, chanText = "1"] = process.argv.slice(2)
const chan = Number(chanText)
const OPEN = 1,
  OPENED = 2,
  DATA = 3,
  CLOSE = 4
const log = process.env.SERIAL_PROXY_DEBUG
  ? (...m) => process.stderr.write(`${m.join(" ")}\n`)
  : () => {}
const t0 = Date.now()

function cobsEncode(data) {
  const out = Buffer.allocUnsafe(data.length + Math.ceil(data.length / 254) + 2)
  let o = 1,
    codeAt = 0,
    code = 1
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 0) {
      out[codeAt] = code
      codeAt = o++
      code = 1
    } else {
      out[o++] = data[i]
      code++
      if (code === 255) {
        out[codeAt] = code
        codeAt = o++
        code = 1
      }
    }
  }
  out[codeAt] = code
  return out.subarray(0, o)
}
function cobsDecode(data) {
  const out = Buffer.allocUnsafe(data.length)
  let o = 0,
    i = 0
  while (i < data.length) {
    const code = data[i]
    data.copy(out, o, i + 1, i + code)
    o += code - 1
    i += code
    if (code < 255 && i < data.length) out[o++] = 0
  }
  return out.subarray(0, o)
}
const frame = (kind, payload = Buffer.alloc(0)) =>
  Buffer.concat([cobsEncode(Buffer.concat([Buffer.from([kind, chan]), payload])), Buffer.from([0])])

let writeRaw, pauseIn, resumeIn
let state = mode === "tcp" ? "hello" : "auth"
let pending = Buffer.alloc(0)
const _frames = []

function onFrame(msg) {
  const kind = msg[0],
    c = msg[1],
    payload = msg.subarray(2)
  if (c !== chan) return
  if (kind === OPENED && state === "hello") {
    state = "relay"
    log("opened", Date.now() - t0, "ms")
    process.stdin.on("data", (d) => {
      for (let i = 0; i < d.length; i += 4096) writeRaw(frame(DATA, d.subarray(i, i + 4096)))
    })
    process.stdin.on("end", () => writeRaw(frame(CLOSE)))
  } else if (kind === DATA && state === "relay") {
    if (!process.stdout.write(payload)) {
      pauseIn()
      process.stdout.once("drain", resumeIn)
    }
  } else if (kind === CLOSE) {
    process.exit(0)
  }
}
function onBytes(data) {
  if (state === "auth" || state === "banner") {
    pending = Buffer.concat([pending, data])
    if (state === "auth") {
      if (pending.length < 2) return
      if (pending.subarray(0, 2).toString() !== "OK") {
        process.stderr.write("termproxy refused\n")
        process.exit(1)
      }
      state = "banner"
    }
    const at = pending.indexOf("starting serial terminal on interface")
    if (at < 0) return
    const eol = pending.indexOf("\n", at)
    if (eol < 0) return
    log("banner", Date.now() - t0, "ms")
    state = "hello"
    data = pending.subarray(eol + 1)
    pending = Buffer.alloc(0)
    setTimeout(hello, Number(process.env.SERIAL_START_DELAY_MS ?? 300))
  }
  pending = Buffer.concat([pending, data])
  for (;;) {
    const end = pending.indexOf(0)
    if (end < 0) break
    const raw = pending.subarray(0, end)
    pending = pending.subarray(end + 1)
    if (raw.length) onFrame(cobsDecode(raw))
  }
}
function hello() {
  writeRaw(Buffer.concat([Buffer.from([0, 0]), frame(OPEN)]))
}

if (mode === "tcp") {
  const sock = net.connect(Number(b), a, () => hello())
  sock.setNoDelay(true)
  writeRaw = (buf) => sock.write(buf)
  pauseIn = () => sock.pause()
  resumeIn = () => sock.resume()
  sock.on("data", onBytes)
  sock.on("close", () => process.exit(0))
} else {
  const ep = endpointFrom()
  const term = await call(ep, "POST", `/nodes/${ep.node}/qemu/${a}/termproxy`, { serial: b })
  const ws = await websocket(
    ep,
    `/nodes/${ep.node}/qemu/${a}/vncwebsocket?port=${term.port}&vncticket=${encodeURIComponent(term.ticket)}`,
  )
  log("websocket", Date.now() - t0, "ms")
  writeRaw = (buf) => {
    for (let i = 0; i < buf.length; i += 65536) {
      const part = buf.subarray(i, i + 65536)
      ws.send(Buffer.concat([Buffer.from(`0:${part.length}:`), part]))
    }
  }
  pauseIn = () => ws.socket.pause()
  resumeIn = () => ws.socket.resume()
  ws.onmessage = onBytes
  ws.onclose = () => process.exit(0)
  ws.sendFrame(0x2, Buffer.from(`${term.user}:${term.ticket}\n`))
  setInterval(() => ws.sendFrame(0x2, Buffer.from("2")), 30000).unref()
}
