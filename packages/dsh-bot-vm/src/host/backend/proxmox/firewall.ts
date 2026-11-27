import type { ProxmoxFirewallRule, ProxmoxParams } from "./client"
import { SSH_PORT } from "./layout"

export const BLOCKED_IPV4 = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "224.0.0.0/3",
] as const

export const BLOCKED_IPV6 = "::/0"

export const FIREWALL_OPTIONS: ProxmoxParams = {
  enable: 1,
  policy_in: "DROP",
  policy_out: "ACCEPT",
  dhcp: 1,
  macfilter: 1,
  ipfilter: 1,
  ndp: 0,
  radv: 0,
}

export interface FirewallInput {
  readonly sshSource: string
  readonly nameservers: readonly string[]
}

function ipv4Number(address: string): number {
  return address.split(".").reduce((value, part) => value * 256 + Number(part), 0)
}

export function blockedIpv4(address: string): boolean {
  const value = ipv4Number(address)
  return BLOCKED_IPV4.some((cidr) => {
    const [base, bits] = cidr.split("/") as [string, string]
    const size = 2 ** (32 - Number(bits))
    const start = Math.floor(ipv4Number(base) / size) * size
    return value >= start && value < start + size
  })
}

export function firewallRules(input: FirewallInput): readonly ProxmoxFirewallRule[] {
  const dns = input.nameservers.filter(blockedIpv4).flatMap((server) =>
    (["udp", "tcp"] as const).map((proto) => ({
      type: "out",
      action: "ACCEPT",
      proto,
      dport: "53",
      dest: server,
      enable: 1,
      comment: "dsh-bots: the bot VMs' DNS server",
    })),
  )
  return [
    {
      type: "in",
      action: "ACCEPT",
      proto: "tcp",
      dport: String(SSH_PORT),
      source: input.sshSource,
      enable: 1,
      comment: "dsh-bots: SSH from the DSH host",
    },
    ...dns,
    {
      type: "out",
      action: "REJECT",
      dest: BLOCKED_IPV4.join(","),
      enable: 1,
      comment: "dsh-bots: no private, CGNAT, loopback, link-local, multicast or reserved networks",
    },
    {
      type: "out",
      action: "REJECT",
      dest: BLOCKED_IPV6,
      enable: 1,
      comment: "dsh-bots: no IPv6",
    },
  ]
}
