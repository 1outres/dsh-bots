import type { ProxmoxClient } from "./client"
import { FIREWALL_OPTIONS, type FirewallInput, firewallRules } from "./firewall"
import { IPFILTER_SET, macOf, NIC } from "./layout"

const LINK_LOCAL = /^169\.254\./

const ruleText = (rule: {
  readonly type?: unknown
  readonly action?: unknown
  readonly dest?: unknown
  readonly source?: unknown
}) => [rule.type, rule.action, rule.dest ?? "", rule.source ?? ""].join(" ")

export async function writeFirewall(
  client: ProxmoxClient,
  vmid: number,
  input: FirewallInput,
  signal?: AbortSignal,
): Promise<void> {
  await client.firewallOptions(vmid, FIREWALL_OPTIONS, signal)
  const existing = [...(await client.firewallRules(vmid, signal))].sort((a, b) => b.pos - a.pos)
  for (const rule of existing) await client.deleteFirewallRule(vmid, rule.pos, signal)
  const rules = firewallRules(input)
  for (const rule of [...rules].reverse()) {
    await client.addFirewallRule(vmid, { ...rule, pos: 0 }, signal)
  }
  const written = (await client.firewallRules(vmid, signal)).map(ruleText)
  const wanted = rules.map(ruleText)
  if (written.join("\n") !== wanted.join("\n")) {
    throw new Error(
      `the firewall of VM ${vmid} did not keep its rules in order (${written.join("; ")}); its VM is not used`,
    )
  }
  if (!(await client.ipsets(vmid, signal)).includes(IPFILTER_SET)) {
    await client.createIpset(vmid, IPFILTER_SET, signal)
  }
}

export async function guestAddress(
  client: ProxmoxClient,
  vmid: number,
  nic: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const mac = macOf(nic)
  if (mac === undefined) throw new Error(`VM ${vmid} has no virtio ${NIC} with a MAC address`)
  let interfaces: Awaited<ReturnType<ProxmoxClient["guestInterfaces"]>>
  try {
    interfaces = await client.guestInterfaces(vmid, signal)
  } catch (error) {
    throw new Error(
      `the QEMU guest agent of VM ${vmid} does not answer yet, so its address is unknown: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const address = interfaces
    .filter((entry) => entry.mac === mac)
    .flatMap((entry) => entry.ipv4)
    .find((ip) => !LINK_LOCAL.test(ip))
  if (address === undefined)
    throw new Error(`VM ${vmid} has no IPv4 address on ${NIC} (${mac}) yet`)
  return address
}

export async function pinAddress(
  client: ProxmoxClient,
  vmid: number,
  address: string,
  signal?: AbortSignal,
): Promise<void> {
  const entries = await client.ipsetEntries(vmid, IPFILTER_SET, signal)
  for (const entry of entries) {
    if (entry !== address && entry !== `${address}/32`) {
      await client.deleteIpsetEntry(vmid, IPFILTER_SET, entry, signal)
    }
  }
  if (!entries.some((entry) => entry === address || entry === `${address}/32`)) {
    await client.addIpsetEntry(vmid, IPFILTER_SET, address, signal)
  }
}
