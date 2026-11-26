import type { HostSiteView, PinnedHostKey } from "@1outres/dsh-bot-core"
import type { StoredSite } from "../placement/placement"

export type TargetSite =
  | { readonly kind: "this-machine" }
  | {
      readonly kind: "ssh"
      readonly host: string
      readonly port: number
      readonly user: string
      readonly hostKey: string
    }

export type Identity = "kept" | "removed"

export interface SetupTarget {
  readonly site: TargetSite
  readonly project: string
  readonly httpsPort: number
  readonly consents: readonly "zabbly"[]
  readonly identityAfter: "keep" | "remove"
}

export type PinHostKey = (hostKey: string) => PinnedHostKey

export function sameSite(a: TargetSite | StoredSite, b: TargetSite | StoredSite): boolean {
  if (a.kind === "this-machine" || b.kind === "this-machine") return a.kind === b.kind
  return a.host === b.host && a.port === b.port && a.user === b.user
}

export function storedSiteOf(site: TargetSite, identity: Identity): StoredSite {
  return site.kind === "this-machine" ? site : { ...site, identity }
}

export function siteViewOf(site: TargetSite, identity: Identity, pin: PinHostKey): HostSiteView {
  if (site.kind === "this-machine") return site
  const { hostKey, ...rest } = site
  return { ...rest, hostKey: pin(hostKey), identity }
}

const WILDCARD_HOSTS = new Set(["", "0.0.0.0", "[::]", "::"])
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "[::1]", "localhost"])

function splitAddress(address: string): { readonly host: string; readonly port: string } {
  const at = address.lastIndexOf(":")
  if (at < 0) return { host: address, port: "8443" }
  return { host: address.slice(0, at), port: address.slice(at + 1) || "8443" }
}

const hostForUrl = (host: string) =>
  host.includes(":") && !host.startsWith("[") ? `[${host}]` : host

export function endpointUrlOf(site: TargetSite, httpsAddress: string): string {
  const { host, port } = splitAddress(httpsAddress.trim())
  if (!/^[0-9]+$/.test(port))
    throw new Error(`Incus listens on "${httpsAddress}", which names no port`)
  const shared = WILDCARD_HOSTS.has(host) || LOOPBACK_HOSTS.has(host)
  if (!shared) return `https://${hostForUrl(host)}:${port}`
  return site.kind === "this-machine"
    ? `https://127.0.0.1:${port}`
    : `https://${hostForUrl(site.host)}:${port}`
}
