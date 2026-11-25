import { readFileSync } from "node:fs"
import { call, endpointFrom, waitOp } from "./incus.mjs"

const [endpointFile, project] = process.argv.slice(2)
const ep = endpointFrom({ ...JSON.parse(readFileSync(endpointFile, "utf8")), project })
const run = async (m, p, b) => waitOp(ep, await call(ep, m, p, b))
const del = (n) => run("DELETE", `/1.0/instances/${n}`).catch(() => {})
const vm = (name, config = {}, devices = {}) => ({
  name,
  type: "virtual-machine",
  source: { type: "image", alias: "dsh-bot-base" },
  profiles: ["dsh-bot"],
  config,
  devices,
  start: false,
})
const p = async (n, f) => {
  try {
    const v = await f()
    console.log(`OK     ${n}${v ? `  — ${v}` : ""}`)
  } catch (e) {
    console.log(`DENIED ${n}  — ${String(e.message).slice(0, 220)}`)
  }
}
await p("create VM nic on dshbr0", () =>
  run("POST", "/1.0/instances", vm("spk-br", {}, { eth0: { type: "nic", network: "dshbr0" } })),
)
await del("spk-br")
await p("create VM with nic type none", () =>
  run("POST", "/1.0/instances", vm("spk-nonic", {}, { eth0: { type: "none" } })),
)
await del("spk-nonic")
await p("POST custom volume filesystem 1GiB", () =>
  run("POST", "/1.0/storage-pools/dshspike/volumes/custom", {
    name: "ws-fs",
    type: "custom",
    config: { size: "1GiB" },
  }),
)
await p("create VM with filesystem volume at path", () =>
  run(
    "POST",
    "/1.0/instances",
    vm(
      "spk-fsvol",
      {},
      {
        workspace: { type: "disk", pool: "dshspike", source: "ws-fs", path: "/home/bot/workspace" },
      },
    ),
  ),
)
await del("spk-fsvol")
await run("DELETE", "/1.0/storage-pools/dshspike/volumes/custom/ws-fs").catch((e) =>
  console.log(e.message),
)
await p("create VM secureboot/guestapi=false + user.* + cloud-init + limits", () =>
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
      { root: { type: "disk", path: "/", pool: "dshspike", size: "10GiB" } },
    ),
  ),
)
await p("POST instance backup", () => run("POST", "/1.0/instances/spk-ok/backups", { name: "b0" }))
await p("POST instance snapshot", () =>
  run("POST", "/1.0/instances/spk-ok/snapshots", { name: "s0" }),
)
await p("PATCH instance raw.idmap", () =>
  run("PATCH", "/1.0/instances/spk-ok", { config: { "raw.idmap": "uid 1000 1001" } }),
)
await p("PUT instance limits.memory 3GiB, root 11GiB", async () => {
  const cur = (await call(ep, "GET", "/1.0/instances/spk-ok")).metadata
  await run("PUT", "/1.0/instances/spk-ok", {
    architecture: cur.architecture,
    description: cur.description,
    ephemeral: cur.ephemeral,
    stateful: cur.stateful,
    profiles: cur.profiles,
    config: { ...cur.config, "limits.memory": "3GiB" },
    devices: { ...cur.devices, root: { ...cur.devices.root, size: "11GiB" } },
  })
})
await p("expanded_devices eth0 visible", async () =>
  JSON.stringify((await call(ep, "GET", "/1.0/instances/spk-ok")).metadata.expanded_devices.eth0),
)
await del("spk-ok")
