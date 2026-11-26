import { endpointFrom, request } from "./pve.mjs"

const ep = endpointFrom()
const N = `/nodes/${ep.node}`
const rows = [
  ["GET", "/cluster/resources?type=vm"],
  ["GET", `${N}/qemu/500/status/current`],
  ["POST", `${N}/qemu/500/status/stop`],
  ["PUT", `${N}/qemu/500/config`, { memory: 1024 }],
  ["DELETE", `${N}/qemu/500`],
  ["POST", `${N}/qemu/500/termproxy`, { serial: "serial0" }],
  ["POST", `${N}/qemu`, { vmid: 501, name: "outside", memory: 512 }],
  [
    "POST",
    `${N}/qemu`,
    { vmid: 502, name: "in-pool-other-storage", pool: ep.pool, memory: 512, scsi0: "local:1" },
  ],
  [
    "POST",
    `${N}/qemu`,
    { vmid: 503, name: "hostpci", pool: ep.pool, memory: 512, hostpci0: "0000:00:01.0" },
  ],
  [
    "POST",
    `${N}/qemu`,
    { vmid: 504, name: "args", pool: ep.pool, memory: 512, args: "-no-reboot" },
  ],
  [
    "POST",
    `${N}/qemu`,
    { vmid: 505, name: "serialdev", pool: ep.pool, memory: 512, serial0: "/dev/ttyS0" },
  ],
  [
    "POST",
    `${N}/qemu`,
    { vmid: 506, name: "bridge-other", pool: ep.pool, memory: 512, net0: "virtio,bridge=vmbr9" },
  ],
  ["POST", `${N}/qemu`, { vmid: 507, name: "pool-ok", pool: ep.pool, memory: 512 }],
  ["DELETE", `${N}/qemu/507`],
  ["GET", `${N}/storage/local/content`],
  ["POST", `${N}/storage/local/content`, { vmid: 507, filename: "vm-507-disk-9.raw", size: "1G" }],
  ["GET", "/storage/dshbots"],
  ["PUT", "/storage/dshbots", { content: "images,iso" }],
  ["POST", "/storage", { storage: "evil", type: "dir", path: "/", content: "images" }],
  ["GET", `${N}/status`],
  ["GET", `${N}/network`],
  ["POST", `${N}/network`, { iface: "vmbr9", type: "bridge" }],
  ["GET", `${N}/syslog?limit=1`],
  ["POST", `${N}/termproxy`],
  ["POST", `${N}/execute`, { commands: "[]" }],
  ["GET", "/access/users"],
  ["GET", "/access/acl"],
  ["PUT", "/access/acl", { path: "/", roles: "Administrator", tokens: "dsh-bots@pve!plugin" }],
  ["PUT", "/pools/dsh-bots", { vms: "500" }],
  ["GET", `${N}/hardware/pci`],
  ["POST", `${N}/qemu/101/snapshot`, { snapname: "s1" }],
  ["POST", `${N}/vzdump`, { vmid: 101, storage: "dshbots" }],
  ["POST", `${N}/qemu/101/agent/exec`, { command: "true" }],
  ["GET", `${N}/qemu/101/agent/network-get-interfaces`],
  ["GET", "/pools/dsh-bots"],
  ["GET", `${N}/qemu/101/pending`],
  ["GET", `${N}/qemu/101/rrddata?timeframe=hour`],
]
for (const [method, path, body] of rows) {
  const r = await request(ep, method, path, body)
  const msg =
    typeof r.body === "object"
      ? (r.body?.message ?? JSON.stringify(r.body?.data ?? "")).toString()
      : String(r.body)
  console.log(
    `${method} ${path}${body ? ` ${JSON.stringify(body)}` : ""}\n    -> ${r.status} ${r.message} | ${msg.replace(/\s+/g, " ").slice(0, 200)}`,
  )
}
