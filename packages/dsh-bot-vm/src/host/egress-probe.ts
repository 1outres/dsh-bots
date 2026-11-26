/**
 * The measured half of the egress check (docs/specs/incus-endpoint.md §6.4):
 * from inside a bot's VM, short TCP connections to places a bot must not
 * reach (its gateway, private and shared ranges, the link-local metadata
 * address). An established connection means the network lets it through; a
 * refused or silent one tells nothing apart, so only connections count. The
 * result only warns: the bot keeps running (§10 item 5).
 */

export interface EgressTarget {
  readonly host: string
  readonly port: number
}

/** One address of each range a bot VM must not reach, at ports something usually listens on. */
export const EGRESS_TARGETS: readonly EgressTarget[] = [
  { host: "10.0.0.1", port: 22 },
  { host: "172.16.0.1", port: 22 },
  { host: "192.168.0.1", port: 80 },
  { host: "192.168.1.1", port: 80 },
  { host: "100.64.0.1", port: 22 },
  { host: "169.254.169.254", port: 80 },
]

/** Ports of the VM's own gateway (the VM host) tried besides; DNS and DHCP stay allowed there. */
export const GATEWAY_PORTS: readonly number[] = [22, 80, 443, 8443]

/** Seconds one connection may take. */
export const EGRESS_CONNECT_SECONDS = 2

export type EgressReport =
  | { readonly state: "isolated"; readonly at: number; readonly gateway: string | undefined }
  | {
      readonly state: "open"
      readonly at: number
      readonly gateway: string | undefined
      /** `host:port` of every connection that was established. */
      readonly reached: readonly string[]
    }
  | { readonly state: "unmeasured"; readonly at: number; readonly reason: string }

/**
 * A bash script for the guest: prints `gateway <hex>` (the default route of
 * /proc/net/route, so no tool beyond bash is needed) and `open <host>:<port>`
 * for each established connection, all tried at once.
 */
export function egressProbeScript(): string {
  const seconds = EGRESS_CONNECT_SECONDS
  const fixed = EGRESS_TARGETS.map((target) => `${target.host}:${target.port}`).join(" ")
  return [
    `try() { if timeout ${seconds} bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null; then echo "open $1:$2"; fi; }`,
    `hex=$(awk '$2 == "00000000" { print $3; exit }' /proc/net/route)`,
    'gw=""',
    `if [ -n "$hex" ]; then gw=$((16#\${hex:6:2})).$((16#\${hex:4:2})).$((16#\${hex:2:2})).$((16#\${hex:0:2})); fi`,
    'echo "gateway $gw"',
    `for t in ${fixed}; do try "\${t%:*}" "\${t#*:}" & done`,
    `if [ -n "$gw" ]; then for p in ${GATEWAY_PORTS.join(" ")}; do try "$gw" "$p" & done; fi`,
    "wait",
  ].join("\n")
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/
const OPENED = /^open (\d{1,3}(?:\.\d{1,3}){3}:\d{1,5})$/

/** The report of the script's output. */
export function egressReportOf(stdout: string, at: number): EgressReport {
  const lines = stdout.split("\n").map((line) => line.trim())
  const gatewayLine = lines.find((line) => line.startsWith("gateway"))
  if (gatewayLine === undefined) {
    return { state: "unmeasured", at, reason: "the probe printed no gateway line" }
  }
  const named = gatewayLine.slice("gateway".length).trim()
  const gateway = IPV4.test(named) ? named : undefined
  const reached = [...new Set(lines.flatMap((line) => OPENED.exec(line)?.slice(1, 2) ?? []))].sort()
  return reached.length === 0
    ? { state: "isolated", at, gateway }
    : { state: "open", at, gateway, reached }
}
