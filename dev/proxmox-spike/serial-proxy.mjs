import { randomBytes } from "node:crypto"
import { call, endpointFrom, websocket } from "./pve.mjs"

const [vmid, iface = "serial1"] = process.argv.slice(2)
const ep = endpointFrom()
const log = process.env.SERIAL_PROXY_DEBUG
  ? (...a) => process.stderr.write(`${a.join(" ")}\n`)
  : () => {}
const t0 = Date.now()
const term = await call(ep, "POST", `/nodes/${ep.node}/qemu/${vmid}/termproxy`, { serial: iface })
log("termproxy", Date.now() - t0, "ms", JSON.stringify({ port: term.port, user: term.user }))
const ws = await websocket(
  ep,
  `/nodes/${ep.node}/qemu/${vmid}/vncwebsocket?port=${term.port}&vncticket=${encodeURIComponent(term.ticket)}`,
)
log("websocket", Date.now() - t0, "ms")
const nonce = randomBytes(8).toString("hex")
const ready = Buffer.from(`DSH-SSH-READY ${nonce}\n`)
let state = "auth"
let pending = Buffer.alloc(0)
const send = (buf) => {
  for (let i = 0; i < buf.length; i += 65536) {
    const part = buf.subarray(i, i + 65536)
    ws.send(Buffer.concat([Buffer.from(`0:${part.length}:`), part]))
  }
}
ws.onmessage = (data) => {
  if (state === "relay") {
    if (!process.stdout.write(data)) {
      ws.socket.pause()
      process.stdout.once("drain", () => ws.socket.resume())
    }
    return
  }
  pending = Buffer.concat([pending, data])
  if (state === "auth") {
    if (pending.length < 2) return
    if (pending.subarray(0, 2).toString() !== "OK") {
      process.stderr.write(`termproxy refused: ${pending.toString()}\n`)
      process.exit(1)
    }
    pending = pending.subarray(2)
    state = "banner"
    log("auth ok", Date.now() - t0, "ms")
  }
  if (state === "banner") {
    const at = pending.indexOf("starting serial terminal on interface")
    if (at < 0) return
    state = "hello"
    log("banner", Date.now() - t0, "ms")
    setTimeout(
      () => send(Buffer.from(`\nDSH-SSH-START ${nonce}\n`)),
      Number(process.env.SERIAL_START_DELAY_MS ?? 300),
    )
  }
  if (state === "hello") {
    const at = pending.indexOf(ready)
    if (at < 0) return
    log("ready", Date.now() - t0, "ms", "skipped", at, "bytes")
    const rest = pending.subarray(at + ready.length)
    pending = Buffer.alloc(0)
    state = "relay"
    if (rest.length) process.stdout.write(rest)
    process.stdin.on("data", (d) => {
      if (!send(d) && ws.socket.writableNeedDrain) {
        process.stdin.pause()
        ws.socket.once("drain", () => process.stdin.resume())
      }
    })
    process.stdin.on("end", () => {
      ws.close()
      setTimeout(() => process.exit(0), 200)
    })
  }
}
ws.onclose = () => process.exit(0)
ws.sendFrame(0x2, Buffer.from(`${term.user}:${term.ticket}\n`))
setInterval(() => ws.sendFrame(0x2, Buffer.from("2")), 30000).unref()
