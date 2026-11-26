import { call, endpointFrom } from "./pve.mjs"

const [vmid] = process.argv.slice(2)
const ep = endpointFrom()
const A = `/nodes/${ep.node}/qemu/${vmid}/agent`
const times = []
for (let i = 0; i < 5; i++) {
  const t = Date.now()
  const { pid } = await call(ep, "POST", `${A}/exec`, { command: ["/bin/true"] })
  for (;;) {
    const st = await call(ep, "GET", `${A}/exec-status?pid=${pid}`)
    if (st.exited) break
    await new Promise((r) => setTimeout(r, 20))
  }
  times.push(Date.now() - t)
}
console.log("exec true (incl. polling)", times.join(" "), "ms")
const _mk = await call(ep, "POST", `${A}/exec`, {
  command: ["/bin/sh", "-c", "head -c 1048576 /dev/urandom > /tmp/agent-1m"],
})
await new Promise((r) => setTimeout(r, 1500))
let t = Date.now()
const r = await call(ep, "GET", `${A}/file-read?file=/tmp/agent-1m`)
console.log(
  "file-read 1MiB",
  Date.now() - t,
  "ms",
  "bytes",
  Buffer.from(r.content, r.encoding ?? "base64").length,
  "truncated",
  r.truncated ?? 0,
)
const big = Buffer.alloc(1 << 20, 0x41).toString()
t = Date.now()
try {
  await call(ep, "POST", `${A}/file-write`, { file: "/tmp/agent-w", content: big.slice(0, 60000) })
  console.log("file-write 60000 B", Date.now() - t, "ms")
} catch (e) {
  console.log("file-write", e.message)
}
