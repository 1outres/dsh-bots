import { RemoteError } from "@deepseek-ai/dsh-typert-protocol"
import {
  type CustomConnectRequest,
  type CustomCredential,
  IDENTITY_REMOVALS,
  type IdentityRemoval,
} from "../../shared/environment-host"
import type {
  ConsentNeed,
  PinnedHostKey,
  SetupInspectRequest,
  SetupSite,
  SetupStartRequest,
  SshTarget,
} from "../../shared/vm-host-setup"

export const MAX_TRUST_TOKEN_LENGTH = 8192
const MAX_FIELD_LENGTH = 2048
const MAX_PASSWORD_LENGTH = 1024
const MAX_NAMESERVERS = 3
const CONSENT_IDS: readonly ConsentNeed["id"][] = ["zabbly"]
const IDENTITY_AFTER = ["keep", "remove"] as const

const bad = (message: string) => new RemoteError("gateway/bad-request", message, {})

function text(value: unknown, what: string, limit = MAX_FIELD_LENGTH): string {
  if (typeof value !== "string") throw bad(`${what} must be text`)
  const trimmed = value.trim()
  if (trimmed === "") throw bad(`${what} is empty`)
  if (trimmed.length > limit) throw bad(`${what} is longer than ${limit}`)
  return trimmed
}

function texts(value: unknown, what: string, limit: number): readonly string[] {
  if (!Array.isArray(value)) throw bad(`${what} must be a list`)
  if (value.length === 0) throw bad(`${what} is empty`)
  if (value.length > limit) throw bad(`${what} has more than ${limit} entries`)
  return value.map((item, index) => text(item, `${what}[${index}]`))
}

function recordOf(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw bad(`${what} must be an object`)
  }
  return value as Record<string, unknown>
}

function port(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw bad(`${what} must be a port from 1 to 65535`)
  }
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const found = allowed.find((item) => item === value)
  if (found === undefined) throw bad(`${what} must be one of ${allowed.join(", ")}`)
  return found
}

function password(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") throw bad("sudoPassword must be text")
  if (value === "") throw bad("sudoPassword is empty")
  if (value.length > MAX_PASSWORD_LENGTH)
    throw bad(`sudoPassword is longer than ${MAX_PASSWORD_LENGTH}`)
  if (/[\r\n]/.test(value)) throw bad("sudoPassword must be one line")
  return value
}

export function parseCustomCredential(value: unknown): CustomCredential {
  const record = recordOf(value, "credential")
  switch (record.backend) {
    case "incus":
      return {
        backend: "incus",
        trustToken: text(record.trustToken, "trustToken", MAX_TRUST_TOKEN_LENGTH),
      }
    case "proxmox":
      return { backend: "proxmox", url: text(record.url, "url") }
    default:
      throw bad("credential.backend must be incus or proxmox")
  }
}

export function parseCustomConnectRequest(value: unknown): CustomConnectRequest {
  const record = recordOf(value, "request")
  switch (record.backend) {
    case "incus":
      return {
        backend: "incus",
        token: text(record.token, "token", MAX_TRUST_TOKEN_LENGTH),
        url: text(record.url, "url"),
        project: text(record.project, "project"),
      }
    case "proxmox":
      return {
        backend: "proxmox",
        url: text(record.url, "url"),
        tokenId: text(record.tokenId, "tokenId"),
        tokenSecret: text(record.tokenSecret, "tokenSecret"),
        serverFingerprint: text(record.serverFingerprint, "serverFingerprint"),
        node: text(record.node, "node"),
        pool: text(record.pool, "pool"),
        storage: text(record.storage, "storage"),
        bridge: text(record.bridge, "bridge"),
        sshSource: text(record.sshSource, "sshSource"),
        nameservers: texts(record.nameservers, "nameservers", MAX_NAMESERVERS),
      }
    default:
      throw bad("request.backend must be incus or proxmox")
  }
}

export function parseSshTarget(value: unknown): SshTarget {
  const record = recordOf(value, "target")
  return {
    host: text(record.host, "target.host"),
    port: port(record.port, "target.port"),
    user: text(record.user, "target.user"),
  }
}

function parsePinnedHostKey(value: unknown): PinnedHostKey {
  const record = recordOf(value, "hostKey")
  return {
    type: text(record.type, "hostKey.type"),
    fingerprint: text(record.fingerprint, "hostKey.fingerprint"),
  }
}

export function parseSetupSite(value: unknown): SetupSite {
  const record = recordOf(value, "site")
  switch (record.kind) {
    case "this-machine":
      return { kind: "this-machine" }
    case "ssh":
      return {
        kind: "ssh",
        target: parseSshTarget(record.target),
        hostKey: parsePinnedHostKey(record.hostKey),
      }
    default:
      throw bad("site.kind must be this-machine or ssh")
  }
}

export function parseSetupInspectRequest(value: unknown): SetupInspectRequest {
  const record = recordOf(value, "request")
  return { site: parseSetupSite(record.site), httpsPort: port(record.httpsPort, "httpsPort") }
}

export function parseSetupStartRequest(value: unknown): SetupStartRequest {
  const record = recordOf(value, "request")
  if (!Array.isArray(record.consents)) throw bad("consents must be a list")
  const consents = [...new Set(record.consents.map((id) => oneOf(id, CONSENT_IDS, "consent")))]
  const sudoPassword = password(record.sudoPassword)
  return {
    inspectionId: text(record.inspectionId, "inspectionId"),
    project: text(record.project, "project"),
    httpsPort: port(record.httpsPort, "httpsPort"),
    ...(sudoPassword === undefined ? {} : { sudoPassword }),
    consents,
    ...(record.identityAfter === undefined
      ? {}
      : { identityAfter: oneOf(record.identityAfter, IDENTITY_AFTER, "identityAfter") }),
  }
}

export const parseIdentityRemoval = (value: unknown): IdentityRemoval =>
  oneOf(value, IDENTITY_REMOVALS, "scope")

export const parseJobId = (value: unknown): string => text(value, "jobId")
