import { endpointFrom, request, task } from "./pve.mjs"

const ep = endpointFrom()
const N = `/nodes/${ep.node}`
const HOLDER = 190
const show = (m, r) =>
  console.log(m, r.status, r.message, JSON.stringify(r.body?.data ?? r.body).slice(0, 400))
const exists = await request(ep, "GET", `${N}/qemu/${HOLDER}/status/current`)
if (exists.status !== 200)
  await task(ep, ep.node, "POST", `${N}/qemu`, {
    vmid: HOLDER,
    name: "dsh-bots-volumes",
    pool: ep.pool,
    memory: 64,
    description: "holds dsh-bots workspace volumes; never started",
  })
const vol = `${ep.storage}:${HOLDER}/vm-${HOLDER}-ws-probe.raw`
show(
  "alloc",
  await request(ep, "POST", `${N}/storage/${ep.storage}/content`, {
    vmid: HOLDER,
    filename: `vm-${HOLDER}-ws-probe.raw`,
    size: "1G",
    format: "raw",
  }),
)
show("list holder", await request(ep, "GET", `${N}/storage/${ep.storage}/content?vmid=${HOLDER}`))
await task(ep, ep.node, "POST", `${N}/qemu`, {
  vmid: 102,
  name: "probe",
  pool: ep.pool,
  memory: 512,
})
show(
  "attach",
  await request(ep, "PUT", `${N}/qemu/102/config`, { virtio1: `${vol},serial=dsh-workspace` }),
)
const r = await request(ep, "PUT", `${N}/qemu/102/resize`, { disk: "virtio1", size: "+1G" })
show("resize", r)
if (r.status === 200)
  await task(ep, ep.node, "GET", `${N}/tasks/${encodeURIComponent(r.body.data)}/status`).catch(
    (e) => console.log(e.message),
  )
await new Promise((res) => setTimeout(res, 2000))
show("config", await request(ep, "GET", `${N}/qemu/102/config`))
await task(ep, ep.node, "DELETE", `${N}/qemu/102?purge=1&destroy-unreferenced-disks=1`)
show(
  "list holder after destroy",
  await request(ep, "GET", `${N}/storage/${ep.storage}/content?vmid=${HOLDER}`),
)
show("holder config", await request(ep, "GET", `${N}/qemu/${HOLDER}/config`))
show(
  "delete volume",
  await request(ep, "DELETE", `${N}/storage/${ep.storage}/content/${encodeURIComponent(vol)}`),
)
