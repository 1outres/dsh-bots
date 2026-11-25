// Spike: what a restricted client certificate (projects=[dsh-spike]) may do. Prints one line per probe.
import { readFileSync } from "node:fs"
import { call, endpointFrom, waitOp } from "./incus.mjs"

const [endpointFile, project] = process.argv.slice(2)
const ep = endpointFrom({ ...JSON.parse(readFileSync(endpointFile, "utf8")), project })
const other = endpointFrom({
  ...JSON.parse(readFileSync(endpointFile, "utf8")),
  project: "default",
})
const results = []
async function probe(name, fn) {
  try {
    const v = await fn()
    results.push([name, "OK", v ?? ""])
  } catch (e) {
    results.push([name, "DENIED/ERR", String(e.message).slice(0, 220)])
  }
}
const run = async (e, m, p, b) => waitOp(e, await call(e, m, p, b))
const vm = (name, config = {}, devices = {}, profiles = ["dsh-bot"]) => ({
  name,
  type: "virtual-machine",
  source: { type: "image", alias: "dsh-bot-base" },
  profiles,
  config,
  devices,
  start: false,
})
const del = (n) => run(ep, "DELETE", `/1.0/instances/${n}`).catch(() => {})

await probe("GET /1.0/resources (host CPU/mem)", async () => {
  const r = await call(ep, "GET", "/1.0/resources")
  return `cpu=${r.metadata.cpu.total} mem=${r.metadata.memory.total}`
})
await probe("GET /1.0/projects/<p>", async () =>
  JSON.stringify((await call(ep, "GET", `/1.0/projects/${project}`)).metadata.config).slice(0, 120),
)
await probe("PATCH /1.0/projects/<p> limits.cpu", () =>
  run(ep, "PATCH", `/1.0/projects/${project}`, { config: { "limits.cpu": "13" } }),
)
await probe("GET /1.0/storage-pools", async () =>
  (await call(ep, "GET", "/1.0/storage-pools")).metadata.join(","),
)
await probe(
  "GET /1.0/storage-pools/dshspike/resources",
  async () => (await call(ep, "GET", "/1.0/storage-pools/dshspike/resources")).metadata.space.total,
)
await probe("GET /1.0/storage-pools/dshspike", async () =>
  JSON.stringify((await call(ep, "GET", "/1.0/storage-pools/dshspike")).metadata.config),
)
await probe("GET /1.0/networks", async () =>
  (await call(ep, "GET", "/1.0/networks")).metadata.join(","),
)
await probe(
  "GET /1.0/networks/dshspk0 (security.acls)",
  async () => (await call(ep, "GET", "/1.0/networks/dshspk0")).metadata.config["security.acls"],
)
await probe(
  "GET /1.0/networks/dshbr0 (not in access list)",
  async () => (await call(ep, "GET", "/1.0/networks/dshbr0")).metadata.config["security.acls"],
)
await probe("GET /1.0/network-acls", async () =>
  JSON.stringify((await call(ep, "GET", "/1.0/network-acls")).metadata),
)
await probe("GET /1.0/network-acls/dsh-spike-egress", async () =>
  JSON.stringify((await call(ep, "GET", "/1.0/network-acls/dsh-spike-egress")).metadata.egress),
)
await probe("POST /1.0/networks (create bridge)", () =>
  run(ep, "POST", "/1.0/networks", { name: "spkx0", type: "bridge", config: {} }),
)
await probe("POST /1.0/network-acls", () =>
  run(ep, "POST", "/1.0/network-acls", { name: "spk-acl-x" }),
)
await probe(
  "GET /1.0/instances?project=default",
  async () => (await call(other, "GET", "/1.0/instances")).metadata.length,
)
await probe(
  "GET /1.0/certificates",
  async () => (await call(ep, "GET", "/1.0/certificates")).metadata.length,
)
await probe("GET /1.0 config visible", async () =>
  JSON.stringify((await call(ep, "GET", "/1.0")).metadata.config ?? null).slice(0, 80),
)

const profile = {
  name: "dsh-bot",
  description: "spike",
  config: { "limits.cpu": "2", "limits.memory": "2GiB", "boot.autostart": "true" },
  devices: {
    root: { type: "disk", path: "/", pool: "dshspike", size: "10GiB" },
    eth0: { type: "nic", name: "eth0", network: "dshspk0" },
  },
}
await probe("POST /1.0/profiles dsh-bot (root dshspike, nic dshspk0)", () =>
  call(ep, "POST", "/1.0/profiles", profile),
)
await probe("PATCH profile security.guestapi=false", () =>
  call(ep, "PATCH", "/1.0/profiles/dsh-bot", { config: { "security.guestapi": "false" } }),
)
await probe("PATCH profile security.secureboot=false", () =>
  call(ep, "PATCH", "/1.0/profiles/dsh-bot", { config: { "security.secureboot": "false" } }),
)
await probe("PATCH profile nic security.port_isolation/mac/ipv4 filtering", () =>
  call(ep, "PATCH", "/1.0/profiles/dsh-bot", {
    devices: {
      eth0: {
        type: "nic",
        name: "eth0",
        network: "dshspk0",
        "security.port_isolation": "true",
        "security.mac_filtering": "true",
        "security.ipv4_filtering": "true",
      },
    },
  }),
)
await probe("POST profile with nic on dshbr0 (not allowed network)", () =>
  call(ep, "POST", "/1.0/profiles", {
    name: "x-br",
    devices: { eth0: { type: "nic", network: "dshbr0" } },
  }),
)
await probe("POST profile with nic nictype=bridged parent=dshbr0", () =>
  call(ep, "POST", "/1.0/profiles", {
    name: "x-br2",
    devices: { eth0: { type: "nic", nictype: "bridged", parent: "dshbr0" } },
  }),
)
await probe("POST profile root on pool dsh (limits.disk.pool.dsh=0)", () =>
  call(ep, "POST", "/1.0/profiles", {
    name: "x-dsh",
    devices: { root: { type: "disk", path: "/", pool: "dsh" } },
  }),
)

await probe("create VM raw.idmap", () =>
  run(
    ep,
    "POST",
    "/1.0/instances",
    vm("spk-idmap", { "raw.idmap": "uid 1000 1001\ngid 1000 1001" }),
  ),
)
await del("spk-idmap")
await probe("create VM host-path disk (virtiofs)", () =>
  run(
    ep,
    "POST",
    "/1.0/instances",
    vm(
      "spk-hostdisk",
      {},
      { workspace: { type: "disk", source: "/tmp/dsh-spike", path: "/home/bot/workspace" } },
    ),
  ),
)
await del("spk-hostdisk")
await probe("create VM raw.qemu", () =>
  run(ep, "POST", "/1.0/instances", vm("spk-rawqemu", { "raw.qemu": "-name x" })),
)
await del("spk-rawqemu")
await probe("create VM security.csm", () =>
  run(ep, "POST", "/1.0/instances", vm("spk-csm", { "security.csm": "false" })),
)
await del("spk-csm")
await probe("create VM proxy device", () =>
  run(
    ep,
    "POST",
    "/1.0/instances",
    vm(
      "spk-proxy",
      {},
      {
        p: {
          type: "proxy",
          listen: "tcp:127.0.0.1:9999",
          connect: "tcp:127.0.0.1:22",
          nat: "false",
        },
      },
    ),
  ),
)
await del("spk-proxy")
await probe("create VM root on pool dsh", () =>
  run(
    ep,
    "POST",
    "/1.0/instances",
    vm("spk-dshpool", {}, { root: { type: "disk", path: "/", pool: "dsh", size: "10GiB" } }),
  ),
)
await del("spk-dshpool")
await probe("create VM security.nesting (VM)", () =>
  run(ep, "POST", "/1.0/instances", vm("spk-nest", { "security.nesting": "true" })),
)
await del("spk-nest")
await probe("create VM volatile.vsock_id", () =>
  run(ep, "POST", "/1.0/instances", vm("spk-vsock", { "volatile.vsock_id": "4242" })),
)
await del("spk-vsock")
await probe("instance in project default", () =>
  run(other, "POST", "/1.0/instances", vm("spk-default", {}, {}, ["default"])),
)

await probe("POST custom volume block 1GiB", () =>
  run(ep, "POST", "/1.0/storage-pools/dshspike/volumes/custom", {
    name: "ws-probe",
    type: "custom",
    content_type: "block",
    config: { size: "1GiB" },
  }),
)
await probe("PATCH custom volume size 2GiB", () =>
  run(ep, "PATCH", "/1.0/storage-pools/dshspike/volumes/custom/ws-probe", {
    config: { size: "2GiB" },
  }),
)
await probe("PATCH volume user.dsh-bot.id", () =>
  run(ep, "PATCH", "/1.0/storage-pools/dshspike/volumes/custom/ws-probe", {
    config: { "user.dsh-bot.id": "probe" },
  }),
)
await probe("POST volume snapshot (restricted.snapshots)", () =>
  run(ep, "POST", "/1.0/storage-pools/dshspike/volumes/custom/ws-probe/snapshots", { name: "s0" }),
)
await probe("DELETE custom volume", () =>
  run(ep, "DELETE", "/1.0/storage-pools/dshspike/volumes/custom/ws-probe"),
)
await probe("POST custom volume on pool dsh", () =>
  run(ep, "POST", "/1.0/storage-pools/dsh/volumes/custom", {
    name: "ws-x",
    type: "custom",
    content_type: "block",
    config: { size: "1GiB" },
  }),
)
await probe("POST custom volume 50GiB (> limits.disk)", () =>
  run(ep, "POST", "/1.0/storage-pools/dshspike/volumes/custom", {
    name: "ws-big",
    type: "custom",
    content_type: "block",
    config: { size: "50GiB" },
  }),
)
await probe("POST /1.0/images/aliases (other alias)", () =>
  call(ep, "POST", "/1.0/images/aliases", {
    name: "spk-alias2",
    target: "9fa1dfcfdef3ac1159cc85e7687d6c8e0a5426104b25fc8e0581a371fd7d91f3",
  }),
)
await probe("DELETE /1.0/images/aliases/spk-alias2", () =>
  call(ep, "DELETE", "/1.0/images/aliases/spk-alias2"),
)
await probe("PUT /1.0 (server config)", () =>
  call(ep, "PATCH", "/1.0", { config: { "core.https_address": "127.0.0.1:8443" } }),
)
for (const [n, s, v] of results)
  console.log((s === "OK" ? "OK     " : "DENIED ") + n + (v === "" ? "" : `  — ${v}`))
