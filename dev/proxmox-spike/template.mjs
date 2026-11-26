import { call, endpointFrom, task } from "./pve.mjs"

const [vmid, volid] = process.argv.slice(2)
const ep = endpointFrom()
const t0 = Date.now()
await task(ep, ep.node, "POST", `/nodes/${ep.node}/qemu`, {
  vmid: Number(vmid),
  name: "dsh-bot-base",
  pool: ep.pool,
  ostype: "l26",
  machine: "q35",
  bios: "ovmf",
  efidisk0: `${ep.storage}:1,efitype=4m,pre-enrolled-keys=0`,
  scsihw: "virtio-scsi-single",
  scsi0: `${ep.storage}:0,import-from=${volid},discard=on,iothread=1`,
  ide2: `${ep.storage}:cloudinit`,
  serial0: "socket",
  boot: "order=scsi0",
  cores: 2,
  memory: 2048,
  net0: `virtio,bridge=${ep.bridge},firewall=1`,
})
console.log("created", Date.now() - t0, "ms")
await task(ep, ep.node, "POST", `/nodes/${ep.node}/qemu/${vmid}/template`)
console.log("template", Date.now() - t0, "ms")
console.log(JSON.stringify(await call(ep, "GET", `/nodes/${ep.node}/qemu/${vmid}/config`), null, 1))
