import { call, endpointFrom, websocket } from "./pve.mjs"

const [vmid, iface, text = "\n", secs = "10"] = process.argv.slice(2)
const ep = endpointFrom()
const term = await call(ep, "POST", `/nodes/${ep.node}/qemu/${vmid}/termproxy`, { serial: iface })
const ws = await websocket(
  ep,
  `/nodes/${ep.node}/qemu/${vmid}/vncwebsocket?port=${term.port}&vncticket=${encodeURIComponent(term.ticket)}`,
)
let out = ""
let sent = false
ws.onmessage = (d) => {
  out += d.toString("latin1")
  if (!sent && out.includes("starting serial terminal")) {
    sent = true
    setTimeout(() => {
      const b = Buffer.from(text.replaceAll("\\n", "\n"))
      ws.send(Buffer.concat([Buffer.from(`0:${b.length}:`), b]))
    }, 300)
  }
}
ws.onclose = () => console.log("closed")
ws.sendFrame(0x2, Buffer.from(`${term.user}:${term.ticket}\n`))
setTimeout(() => {
  console.log(JSON.stringify(out))
  process.exit(0)
}, Number(secs) * 1000)
