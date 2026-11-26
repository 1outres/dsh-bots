import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { nocloudIso } from "./iso.mjs"
import { call, endpointFrom, task } from "./pve.mjs"

const [vmidText, name, wsGiB = "4"] = process.argv.slice(2)
const vmid = Number(vmidText)
const ep = endpointFrom()
const N = `/nodes/${ep.node}`
const dir = `/var/tmp/pve-spike/bots/${name}`
mkdirSync(dir, { recursive: true })
for (const k of ["client", "host"]) {
  if (!existsSync(`${dir}/${k}`))
    execFileSync("ssh-keygen", [
      "-q",
      "-t",
      "ed25519",
      "-N",
      "",
      "-C",
      `${name}-${k}`,
      "-f",
      `${dir}/${k}`,
    ])
}
const hostPub = readFileSync(`${dir}/host.pub`, "utf8").trim()
writeFileSync(`${dir}/known_hosts`, `${name} ${hostPub.split(" ").slice(0, 2).join(" ")}\n`)

const relay = readFileSync(new URL("./guest/dsh-serial-ssh", import.meta.url), "utf8")
const mux = readFileSync(new URL("./guest/dsh-serial-relay", import.meta.url), "utf8")
const muxUnit = readFileSync(new URL("./guest/dsh-serial-relay@.service", import.meta.url), "utf8")
const unit = readFileSync(new URL("./guest/dsh-serial-ssh@.service", import.meta.url), "utf8")
const ws = "/dev/disk/by-id/virtio-dsh-workspace"
const HOLDER = 190
const userData = {
  users: [
    {
      name: "bot",
      lock_passwd: true,
      shell: "/bin/bash",
      ssh_authorized_keys: [readFileSync(`${dir}/client.pub`, "utf8").trim()],
    },
  ],
  disable_root: true,
  ssh_pwauth: false,
  ssh_deletekeys: true,
  ssh_genkeytypes: ["ed25519"],
  ssh_keys: { ed25519_private: readFileSync(`${dir}/host`, "utf8"), ed25519_public: hostPub },
  mounts: [
    [
      ws,
      "/home/bot/workspace",
      "ext4",
      "defaults,x-systemd.makefs,x-systemd.growfs,x-systemd.device-timeout=60s",
      "0",
      "2",
    ],
  ],
  packages: ["qemu-guest-agent"],
  write_files: [
    { path: "/usr/local/sbin/dsh-serial-ssh", permissions: "0755", content: relay },
    { path: "/etc/systemd/system/dsh-serial-ssh@.service", permissions: "0644", content: unit },
    { path: "/usr/local/sbin/dsh-serial-relay", permissions: "0755", content: mux },
    {
      path: "/etc/systemd/system/dsh-serial-relay@.service",
      permissions: "0644",
      content: muxUnit,
    },
  ],
  runcmd: [
    ["systemctl", "daemon-reload"],
    ["systemctl", "start", "--no-block", "qemu-guest-agent.service"],
    [
      "systemctl",
      "enable",
      "--now",
      "--no-block",
      "dsh-serial-relay@ttyS1.service",
      "dsh-serial-ssh@ttyS2.service",
    ],
    [
      "sh",
      "-c",
      'systemctl start "$(systemd-escape --path --suffix=mount /home/bot/workspace)" && chown bot:bot /home/bot/workspace',
    ],
  ],
}
const t0 = Date.now()
const lap = (m) => console.log(m, Date.now() - t0, "ms")

await task(ep, ep.node, "POST", `${N}/qemu/9000/clone`, {
  newid: vmid,
  name,
  pool: ep.pool,
  full: 0,
})
lap("cloned")
const mac = /virtio=([0-9A-F:]+)/i
  .exec((await call(ep, "GET", `${N}/qemu/${vmid}/config`)).net0)[1]
  .toLowerCase()
const seed = nocloudIso({
  "meta-data": `instance-id: ${name}-${Date.now()}\nlocal-hostname: ${name}\n`,
  "user-data": `#cloud-config\n${JSON.stringify(userData, null, 1)}\n`,
  "network-config": `version: 2\nethernets:\n  nic0:\n    match: {macaddress: "${mac}"}\n    dhcp4: true\n`,
})
const iso = `${dir}/seed.iso`
writeFileSync(iso, seed)
execFileSync(
  "node",
  [new URL("./upload.mjs", import.meta.url).pathname, iso, "iso", `dsh-seed-${vmid}.iso`],
  { stdio: "inherit" },
)
lap("seed uploaded")
const wsName = `vm-${HOLDER}-ws-${name}.raw`
const wsVol = `${ep.storage}:${HOLDER}/${wsName}`
const existing = await call(ep, "GET", `${N}/storage/${ep.storage}/content?vmid=${HOLDER}`)
if (!existing.some((v) => v.volid === wsVol)) {
  console.log(
    "alloc",
    await call(ep, "POST", `${N}/storage/${ep.storage}/content`, {
      vmid: HOLDER,
      filename: wsName,
      size: `${wsGiB}G`,
      format: "raw",
    }),
  )
} else console.log("reuse", wsVol)
lap("workspace ready")
await task(ep, ep.node, "POST", `${N}/qemu/${vmid}/config`, {
  cores: 2,
  memory: 2048,
  virtio1: `${wsVol},serial=dsh-workspace,discard=on,iothread=1`,
  ide3: `${ep.storage}:iso/dsh-seed-${vmid}.iso,media=cdrom`,
  serial1: "socket",
  serial2: "socket",
  agent: "enabled=1",
  delete: "ide2",
})
await task(ep, ep.node, "PUT", `${N}/qemu/${vmid}/resize`, { disk: "scsi0", size: "16G" })
lap("configured")
await task(ep, ep.node, "POST", `${N}/qemu/${vmid}/status/start`)
lap("started")
console.log(JSON.stringify(await call(ep, "GET", `${N}/qemu/${vmid}/config`)))
