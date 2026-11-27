import {
  normalizeSha256,
  parseCertificate,
  parseEndpointUrl,
  parseProjectName,
} from "../backend/incus/endpoint"
import {
  type ProxmoxLayout,
  parseLayout,
  parseProxmoxUrl,
  parseTokenId,
} from "../backend/proxmox/endpoint"

export interface StoredIncus {
  readonly kind: "incus"
  readonly url: string
  readonly serverCertificateSha256: string
  readonly clientCertificate: string
  readonly project: string
}

export interface StoredProxmox extends ProxmoxLayout {
  readonly kind: "proxmox"
  readonly url: string
  readonly serverCertificateSha256: string
  readonly tokenId: string
}

export type StoredSite =
  | { readonly kind: "this-machine" }
  | {
      readonly kind: "ssh"
      readonly host: string
      readonly port: number
      readonly user: string
      readonly hostKey: string
      readonly identity: "kept" | "removed"
    }

export interface StoredSetup {
  readonly jobId: string
  readonly completedAt: number
  readonly bundleSha256: string
}

export type StoredOrigin =
  | { readonly kind: "custom" }
  | { readonly kind: "managed"; readonly site: StoredSite; readonly setup: StoredSetup }

export type StoredPlacement =
  | { readonly version: 3; readonly backend: StoredIncus; readonly origin: StoredOrigin }
  | {
      readonly version: 3
      readonly backend: StoredProxmox
      readonly origin: { readonly kind: "custom" }
    }

export const PLACEMENT_VERSION = 3

type Fields = Readonly<Record<string, unknown>>

export function objectOf(value: unknown, what: string): Fields {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`)
  }
  return value as Fields
}

export function textOf(record: Fields, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== "string" || value === "") throw new Error(`${what}: "${key}" is missing`)
  return value
}

function numberOf(record: Fields, key: string, what: string): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${what}: "${key}" is not a whole number`)
  }
  return value
}

const HOST_KEY = /^[a-z0-9@.-]+ [A-Za-z0-9+/]+=*$/
const SHA256_HEX = /^[0-9a-f]{64}$/

export function incusOf(record: Fields, what: string): StoredIncus {
  return {
    kind: "incus",
    url: parseEndpointUrl(textOf(record, "url", what)).origin,
    serverCertificateSha256: normalizeSha256(textOf(record, "serverCertificateSha256", what)),
    clientCertificate: parseCertificate(textOf(record, "clientCertificate", what)),
    project: parseProjectName(textOf(record, "project", what)),
  }
}

function textsOf(record: Fields, key: string, what: string): readonly string[] {
  const value = record[key]
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`${what}: "${key}" is not a list of text`)
  }
  return value
}

function proxmoxOf(record: Fields, what: string): StoredProxmox {
  return {
    kind: "proxmox",
    url: parseProxmoxUrl(textOf(record, "url", what)),
    serverCertificateSha256: normalizeSha256(textOf(record, "serverCertificateSha256", what)),
    tokenId: parseTokenId(textOf(record, "tokenId", what)),
    ...parseLayout({
      node: textOf(record, "node", what),
      pool: textOf(record, "pool", what),
      storage: textOf(record, "storage", what),
      bridge: textOf(record, "bridge", what),
      sshSource: textOf(record, "sshSource", what),
      nameservers: textsOf(record, "nameservers", what),
    }),
  }
}

function siteOf(record: Fields, what: string): StoredSite {
  switch (record.kind) {
    case "this-machine":
      return { kind: "this-machine" }
    case "ssh": {
      const port = numberOf(record, "port", what)
      if (port < 1 || port > 65535) throw new Error(`${what}: the SSH port is out of range`)
      const hostKey = textOf(record, "hostKey", what)
      if (!HOST_KEY.test(hostKey)) throw new Error(`${what}: the host key is not "<type> <base64>"`)
      const identity = record.identity
      if (identity !== "kept" && identity !== "removed") {
        throw new Error(`${what}: the SSH identity is neither kept nor removed`)
      }
      return {
        kind: "ssh",
        host: textOf(record, "host", what),
        port,
        user: textOf(record, "user", what),
        hostKey,
        identity,
      }
    }
    default:
      throw new Error(`${what}: the site has an unknown kind`)
  }
}

function originOf(record: Fields, what: string): StoredOrigin {
  switch (record.kind) {
    case "custom":
      return { kind: "custom" }
    case "managed": {
      const setup = objectOf(record.setup, `${what}: the setup`)
      const bundleSha256 = textOf(setup, "bundleSha256", what)
      if (!SHA256_HEX.test(bundleSha256)) throw new Error(`${what}: bundleSha256 is not a sha256`)
      return {
        kind: "managed",
        site: siteOf(objectOf(record.site, `${what}: the site`), what),
        setup: {
          jobId: textOf(setup, "jobId", what),
          completedAt: numberOf(setup, "completedAt", what),
          bundleSha256,
        },
      }
    }
    default:
      throw new Error(`${what}: the origin has an unknown kind`)
  }
}

export function placementOfRecord(record: Fields, what: string): StoredPlacement {
  if (record.version !== PLACEMENT_VERSION) throw new Error(`${what} is not version 3`)
  const backend = objectOf(record.backend, `${what}: the backend`)
  const origin = originOf(objectOf(record.origin, `${what}: the origin`), what)
  switch (backend.kind) {
    case "incus":
      return { version: 3, backend: incusOf(backend, what), origin }
    case "proxmox":
      if (origin.kind !== "custom") throw new Error(`${what}: a Proxmox VM host is never managed`)
      return { version: 3, backend: proxmoxOf(backend, what), origin }
    default:
      throw new Error(`${what}: the backend has an unknown kind`)
  }
}

export function serializePlacement(placement: StoredPlacement): string {
  return `${JSON.stringify(placement, null, 2)}\n`
}
