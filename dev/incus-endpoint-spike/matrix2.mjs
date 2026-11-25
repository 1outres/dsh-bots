import { readFileSync } from "node:fs"
import { call, endpointFrom, waitOp } from "./incus.mjs"

const [endpointFile, project] = process.argv.slice(2)
const ep = endpointFrom({ ...JSON.parse(readFileSync(endpointFile, "utf8")), project })
const run = async (m, p, b) => waitOp(ep, await call(ep, m, p, b))
for (const n of ["x-br", "x-br2", "x-dsh"])
  await call(ep, "DELETE", `/1.0/profiles/${n}`).catch(() => {})
await run("DELETE", "/1.0/instances/spk-csm").catch(() => {})
console.log("network:", JSON.stringify((await call(ep, "GET", "/1.0/networks/dshspk0")).metadata))
const vm = (name, config = {}, devices = {}) => ({
  name,
  type: "virtual-machine",
  source: { type: "image", alias: "dsh-bot-base" },
  profiles: ["dsh-bot"],
  config,
  devices,
  start: false,
})
const probes = [
  [
    "create VM security.csm=false",
    () => run("POST", "/1.0/instances", vm("spk-csm", { "security.csm": "false" })),
  ],
  [
    "create VM security.nesting=true",
    () => run("POST", "/1.0/instances", vm("spk-nest", { "security.nesting": "true" })),
  ],
  [
    "create VM security.secureboot=false + guestapi=false + user.* + cloud-init + limits",
    () =>
      run(
        "POST",
        "/1.0/instances",
        vm(
          "spk-ok",
          {
            "security.secureboot": "false",
            "security.guestapi": "false",
            "user.dsh-bot.id": "x",
            "cloud-init.user-data": "#cloud-config\n{}",
            "limits.cpu": "2",
            "limits.memory": "2GiB",
          },
          { root: { type: "disk", path: "/", pool: "dshspike", size: "12GiB" } },
        ),
      ),
  ],
  [
    "create VM nic on dshbr0",
    () =>
      run("POST", "/1.0/instances", vm("spk-br", {}, { eth0: { type: "nic", network: "dshbr0" } })),
  ],
  [
    "create VM nic without nic (none)",
    () => run("POST", "/1.0/instances", vm("spk-nonic", {}, { eth0: { type: "none" } })),
  ],
  [
    "POST custom volume block 1GiB",
    () =>
      run("POST", "/1.0/storage-pools/dshspike/volumes/custom", {
        name: "ws-probe",
        type: "custom",
        content_type: "block",
        config: { size: "1GiB" },
      }),
  ],
  [
    "PATCH custom volume size 2GiB",
    () =>
      run("PATCH", "/1.0/storage-pools/dshspike/volumes/custom/ws-probe", {
        config: { size: "2GiB" },
      }),
  ],
  [
    "PATCH volume user.dsh-bot.id",
    () =>
      run("PATCH", "/1.0/storage-pools/dshspike/volumes/custom/ws-probe", {
        config: { "user.dsh-bot.id": "probe" },
      }),
  ],
  [
    "POST volume snapshot",
    () =>
      run("POST", "/1.0/storage-pools/dshspike/volumes/custom/ws-probe/snapshots", { name: "s0" }),
  ],
  [
    "DELETE custom volume",
    () => run("DELETE", "/1.0/storage-pools/dshspike/volumes/custom/ws-probe"),
  ],
  [
    "POST custom volume filesystem 1GiB",
    () =>
      run("POST", "/1.0/storage-pools/dshspike/volumes/custom", {
        name: "ws-fs",
        type: "custom",
        config: { size: "1GiB" },
      }),
  ],
  [
    "create VM with filesystem volume at path",
    () =>
      run(
        "POST",
        "/1.0/instances",
        vm(
          "spk-fsvol",
          {},
          {
            workspace: {
              type: "disk",
              pool: "dshspike",
              source: "ws-fs",
              path: "/home/bot/workspace",
            },
          },
        ),
      ),
  ],
  ["POST instance backup", () => run("POST", "/1.0/instances/spk-ok/backups", { name: "b0" })],
  ["POST instance snapshot", () => run("POST", "/1.0/instances/spk-ok/snapshots", { name: "s0" })],
  [
    "PUT instance raw.idmap later",
    () => run("PATCH", "/1.0/instances/spk-ok", { config: { "raw.idmap": "uid 1000 1001" } }),
  ],
  [
    "PATCH instance limits.memory 3GiB, root 14GiB",
    async () => {
      const cur = (await call(ep, "GET", "/1.0/instances/spk-ok")).metadata
      return run("PUT", "/1.0/instances/spk-ok", {
        ...cur,
        config: { ...cur.config, "limits.memory": "3GiB" },
        devices: { ...cur.devices, root: { ...cur.devices.root, size: "14GiB" } },
      })
    },
  ],
]
for (const [n, f] of probes) {
  try {
    await f()
    console.log(`OK     ${n}`)
  } catch (e) {
    console.log(`DENIED ${n}  — ${String(e.message).slice(0, 220)}`)
  }
}
for (const n of ["spk-csm", "spk-nest", "spk-br", "spk-nonic", "spk-fsvol", "spk-ok"])
  await run("DELETE", `/1.0/instances/${n}`).catch(() => {})
await run("DELETE", "/1.0/storage-pools/dshspike/volumes/custom/ws-fs").catch((e) =>
  console.log(e.message),
)
