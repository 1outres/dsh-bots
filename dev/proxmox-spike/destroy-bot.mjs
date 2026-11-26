import { call, endpointFrom, task } from "./pve.mjs"

const [vmidText, mode] = process.argv.slice(2)
const vmid = Number(vmidText)
const ep = endpointFrom()
const N = `/nodes/${ep.node}`
const st = await call(ep, "GET", `${N}/qemu/${vmid}/status/current`)
if (st.status === "running") await task(ep, ep.node, "POST", `${N}/qemu/${vmid}/status/stop`)
if (mode === "keep") {
  await task(ep, ep.node, "PUT", `${N}/qemu/${vmid}/config`, { delete: "virtio1" })
  const cfg = await call(ep, "GET", `${N}/qemu/${vmid}/config`)
  console.log(
    "after detach:",
    Object.entries(cfg).filter(([k]) => k.startsWith("unused") || k === "virtio1"),
  )
}
await task(ep, ep.node, "DELETE", `${N}/qemu/${vmid}?purge=1&destroy-unreferenced-disks=0`)
const iso = `${ep.storage}:iso/dsh-seed-${vmid}.iso`
await call(ep, "DELETE", `${N}/storage/${ep.storage}/content/${encodeURIComponent(iso)}`).catch(
  (e) => console.log("iso:", e.message),
)
console.log(
  "left for vmid:",
  JSON.stringify(await call(ep, "GET", `${N}/storage/${ep.storage}/content?vmid=${vmid}`)),
)
