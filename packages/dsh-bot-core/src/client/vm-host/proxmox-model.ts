import type { CustomConnectRequest, CustomPreview } from "../../shared/environment-host"
import { endpointUrlAllowed } from "./model"

export type ProxmoxPreview = Extract<CustomPreview, { readonly backend: "proxmox" }>

export interface ProxmoxForm {
  readonly url: string
  readonly preview: ProxmoxPreview | null
  readonly tokenId: string
  readonly tokenSecret: string
  readonly node: string
  readonly pool: string
  readonly storage: string
  readonly bridge: string
  readonly sshSource: string
  readonly nameservers: string
}

export const DEFAULT_PROXMOX_POOL = "dsh-bots"
export const DEFAULT_PROXMOX_STORAGE = "dshbots"
export const DEFAULT_PROXMOX_BRIDGE = "vmbr0"
export const DEFAULT_NAMESERVERS = "1.1.1.1 9.9.9.9"

const TOKEN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9._-]*![A-Za-z][A-Za-z0-9._-]*$/
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const MAX_NAMESERVERS = 3

export const emptyProxmox = (): ProxmoxForm => ({
  url: "",
  preview: null,
  tokenId: "",
  tokenSecret: "",
  node: "",
  pool: DEFAULT_PROXMOX_POOL,
  storage: DEFAULT_PROXMOX_STORAGE,
  bridge: DEFAULT_PROXMOX_BRIDGE,
  sshSource: "",
  nameservers: DEFAULT_NAMESERVERS,
})

export function proxmoxPreviewed(form: ProxmoxForm, preview: ProxmoxPreview): ProxmoxForm {
  return {
    ...form,
    url: preview.url,
    preview,
    sshSource: form.sshSource === "" ? preview.sourceAddress : form.sshSource,
  }
}

export const tokenIdAllowed = (text: string) => TOKEN_ID.test(text.trim())
export const nameAllowed = (text: string) => NAME.test(text.trim())
export const ipv4Allowed = (text: string) => IPV4.test(text.trim())

export function nameserversOf(text: string): readonly string[] | null {
  const servers = text.split(/[\s,]+/).filter((item) => item !== "")
  if (servers.length === 0 || servers.length > MAX_NAMESERVERS) return null
  return servers.every(ipv4Allowed) && new Set(servers).size === servers.length ? servers : null
}

export const proxmoxUrlAllowed = endpointUrlAllowed

export function proxmoxRequest(form: ProxmoxForm): CustomConnectRequest | null {
  const { preview } = form
  if (preview === null || preview.url !== form.url) return null
  const nameservers = nameserversOf(form.nameservers)
  if (
    nameservers === null ||
    !tokenIdAllowed(form.tokenId) ||
    form.tokenSecret.trim() === "" ||
    ![form.node, form.pool, form.storage, form.bridge].every(nameAllowed) ||
    !ipv4Allowed(form.sshSource)
  ) {
    return null
  }
  return {
    backend: "proxmox",
    url: preview.url,
    tokenId: form.tokenId.trim(),
    tokenSecret: form.tokenSecret.trim(),
    serverFingerprint: preview.serverFingerprint,
    node: form.node.trim(),
    pool: form.pool.trim(),
    storage: form.storage.trim(),
    bridge: form.bridge.trim(),
    sshSource: form.sshSource.trim(),
    nameservers,
  }
}

export const createPoolCommand = (version: string): string =>
  [
    `curl -fsSL https://codeload.github.com/1outres/dsh-bots/tar.gz/v${version} | tar -xz --strip-components=1 dsh-bots-${version}/infra`,
    "infra/proxmox/create-pool.sh --help",
  ].join("\n")
