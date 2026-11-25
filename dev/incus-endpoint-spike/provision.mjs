// Spike: provision a bot-like VM whose workspace is a block custom volume (as the restricted client).
// Usage: node provision.mjs <endpoint.json> <project> <vm> <volume> <keysdir>
import { readFileSync } from "node:fs"
import { call, endpointFrom, waitOp } from "./incus.mjs"

const [endpointFile, project, name, volume, keys] = process.argv.slice(2)
const ep = endpointFrom({ ...JSON.parse(readFileSync(endpointFile, "utf8")), project })
const run = async (m, p, b) => waitOp(ep, await call(ep, m, p, b))
const k = (f) => readFileSync(`${keys}/${f}`, "utf8")
const t0 = Date.now()
const exists = await call(ep, "GET", `/1.0/storage-pools/dshspike/volumes/custom/${volume}`).then(
  () => true,
  () => false,
)
if (!exists)
  await run("POST", "/1.0/storage-pools/dshspike/volumes/custom", {
    name: volume,
    type: "custom",
    content_type: "block",
    config: { size: "2GiB", "user.dsh-bot.id": name },
  })
const dev = "/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_workspace"
const userData = {
  users: [
    {
      name: "bot",
      lock_passwd: true,
      shell: "/bin/bash",
      ssh_authorized_keys: [k("id_ed25519.pub").trim()],
    },
  ],
  disable_root: true,
  ssh_pwauth: false,
  ssh_deletekeys: true,
  ssh_genkeytypes: ["ed25519"],
  ssh_keys: { ed25519_private: k("host"), ed25519_public: k("host.pub").trim() },
  // cloud-init's fs_setup reformatted an existing volume (partition: none, overwrite: false) — measured; systemd-makefs only formats a device without a file system.
  mounts: [
    [
      dev,
      "/home/bot/workspace",
      "ext4",
      "defaults,x-systemd.makefs,x-systemd.device-timeout=60s",
      "0",
      "2",
    ],
  ],
  bootcmd: [
    [
      "sh",
      "-c",
      "mkdir -p /etc/systemd/system/home-bot-workspace.mount.d && printf '[Mount]\\nExecStartPost=\\n' >/dev/null; true",
    ],
  ],
  runcmd: [
    [
      "sh",
      "-c",
      "systemctl daemon-reload && systemctl start home-bot-workspace.mount && mountpoint -q /home/bot/workspace && chown 1001:1001 /home/bot/workspace",
    ],
    ["sync"],
  ],
}
await run("POST", "/1.0/instances", {
  name,
  type: "virtual-machine",
  source: { type: "image", alias: "dsh-bot-base" },
  profiles: ["dsh-bot"],
  start: false,
  config: {
    "cloud-init.user-data": `#cloud-config\n${JSON.stringify(userData, null, 2)}`,
    "security.guestapi": "false",
    "user.dsh-bot.id": name,
    "limits.cpu": "2",
    "limits.memory": "2GiB",
  },
  devices: {
    root: { type: "disk", path: "/", pool: "dshspike", size: "10GiB" },
    workspace: { type: "disk", pool: "dshspike", source: volume },
  },
})
console.log("created", Date.now() - t0, "ms")
await run("PUT", `/1.0/instances/${name}/state`, { action: "start" })
console.log("started", Date.now() - t0, "ms")
