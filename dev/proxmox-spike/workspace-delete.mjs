import { call, endpointFrom, request } from "./pve.mjs"

const [volid] = process.argv.slice(2)
const ep = endpointFrom()
const N = `/nodes/${ep.node}`
const HOLDER = 190
const show = (m, r) =>
  console.log(m, r.status, r.message, JSON.stringify(r.body?.data ?? r.body).slice(0, 300))
show("reference", await request(ep, "PUT", `${N}/qemu/${HOLDER}/config`, { virtio15: volid }))
show("detach", await request(ep, "PUT", `${N}/qemu/${HOLDER}/config`, { delete: "virtio15" }))
const cfg = await call(ep, "GET", `${N}/qemu/${HOLDER}/config`)
const unused = Object.entries(cfg).find(([k, v]) => k.startsWith("unused") && v === volid)?.[0]
console.log("unused key", unused)
show("destroy", await request(ep, "PUT", `${N}/qemu/${HOLDER}/config`, { delete: unused }))
show("left", await request(ep, "GET", `${N}/storage/${ep.storage}/content?vmid=${HOLDER}`))
