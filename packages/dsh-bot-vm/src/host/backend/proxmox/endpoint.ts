import { parseEndpointUrl } from "../incus/endpoint"

export interface ProxmoxEndpoint {
  readonly url: string
  readonly serverCertificateSha256: string
  readonly tokenId: string
  readonly tokenSecret: string
}

export interface ProxmoxLayout {
  readonly node: string
  readonly pool: string
  readonly storage: string
  readonly bridge: string
  readonly sshSource: string
  readonly nameservers: readonly string[]
}

const TOKEN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*![A-Za-z][A-Za-z0-9._-]*$/
const TOKEN_SECRET = /^[A-Za-z0-9-]{8,128}$/
const NODE = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/
const POOL = /^[A-Za-z0-9_-]{1,64}$/
const STORAGE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9]$/
const BRIDGE = /^[a-zA-Z][a-zA-Z0-9_.-]{0,14}$/
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const MAX_NAMESERVERS = 3

export const PROXMOX_DEFAULT_PORT = 8006

function matching(pattern: RegExp, value: string, what: string): string {
  const trimmed = value.trim()
  if (!pattern.test(trimmed)) throw new Error(`"${value}" is not a Proxmox ${what}`)
  return trimmed
}

export function parseProxmoxUrl(value: string): string {
  const url = parseEndpointUrl(value.trim())
  return url.port === "" ? `${url.origin}:${PROXMOX_DEFAULT_PORT}` : url.origin
}

export const parseTokenId = (value: string) =>
  matching(TOKEN_ID, value, "API token id (user@realm!name)")
export const parseTokenSecret = (value: string) => matching(TOKEN_SECRET, value, "API token secret")
export const parseNodeName = (value: string) => matching(NODE, value, "node name")
export const parsePoolName = (value: string) => matching(POOL, value, "pool name")
export const parseStorageName = (value: string) => matching(STORAGE, value, "storage name")
export const parseBridgeName = (value: string) => matching(BRIDGE, value, "bridge name")

export function parseIpv4(value: string, what: string): string {
  const trimmed = value.trim()
  if (!IPV4.test(trimmed)) throw new Error(`${what} "${value}" is not an IPv4 address`)
  return trimmed
}

export function parseNameservers(values: readonly string[]): readonly string[] {
  if (values.length === 0) throw new Error("name at least one DNS server for the bot VMs")
  if (values.length > MAX_NAMESERVERS) {
    throw new Error(`name at most ${MAX_NAMESERVERS} DNS servers for the bot VMs`)
  }
  const parsed = values.map((value) => parseIpv4(value, "the DNS server"))
  if (new Set(parsed).size !== parsed.length) throw new Error("a DNS server is named twice")
  return parsed
}

export function parseLayout(layout: ProxmoxLayout): ProxmoxLayout {
  return {
    node: parseNodeName(layout.node),
    pool: parsePoolName(layout.pool),
    storage: parseStorageName(layout.storage),
    bridge: parseBridgeName(layout.bridge),
    sshSource: parseIpv4(layout.sshSource, "the address the VMs see this installation at"),
    nameservers: parseNameservers(layout.nameservers),
  }
}
