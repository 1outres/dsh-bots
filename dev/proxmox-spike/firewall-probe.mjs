import { endpointFrom, request } from "./pve.mjs"

const [vmid] = process.argv.slice(2)
const ep = endpointFrom()
const N = `/nodes/${ep.node}`
const F = `${N}/qemu/${vmid}/firewall`
const show = async (m, method, path, body) => {
  const r = await request(ep, method, path, body)
  console.log(
    m.padEnd(28),
    r.status,
    r.message,
    JSON.stringify(r.body?.data ?? r.body).slice(0, 260),
  )
}
await show("vm options get", "GET", `${F}/options`)
await show("vm options set", "PUT", `${F}/options`, {
  enable: 1,
  policy_in: "DROP",
  policy_out: "ACCEPT",
  macfilter: 1,
  ipfilter: 1,
  dhcp: 1,
  ndp: 0,
  radv: 0,
})
for (const cidr of [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "100.64.0.0/10",
]) {
  await show(`rule out drop ${cidr}`, "POST", `${F}/rules`, {
    type: "out",
    action: "REJECT",
    dest: cidr,
    enable: 1,
    pos: 0,
  })
}
await show("rule out accept dns gw", "POST", `${F}/rules`, {
  type: "out",
  action: "ACCEPT",
  dest: "10.250.77.1",
  proto: "udp",
  dport: "53",
  enable: 1,
  pos: 0,
})
await show("vm rules get", "GET", `${F}/rules`)
await show("vm options get", "GET", `${F}/options`)
await show("vm firewall log", "GET", `${F}/log?limit=3`)
await show("cluster options get", "GET", "/cluster/firewall/options")
await show("cluster options set", "PUT", "/cluster/firewall/options", { enable: 1 })
await show("cluster groups", "GET", "/cluster/firewall/groups")
await show("cluster group create", "POST", "/cluster/firewall/groups", { group: "dshbots" })
await show("cluster aliases", "GET", "/cluster/firewall/aliases")
await show("node firewall options", "GET", `${N}/firewall/options`)
await show("other vm 9000 fw opts", "GET", `${N}/qemu/9000/firewall/options`)
