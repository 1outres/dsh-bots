export type IncusEndpoint =
  | { readonly kind: "local"; readonly socket: string }
  | {
      readonly kind: "remote"
      readonly url: string
      readonly serverCertificateSha256: string
      readonly clientCertificate: string
      readonly clientKey: string
    }

export type StoredEndpoint =
  | { readonly kind: "local"; readonly socket: string }
  | {
      readonly kind: "remote"
      readonly url: string
      readonly serverCertificateSha256: string
      readonly clientCertificate: string
    }

export interface StoredScope {
  readonly endpoint: StoredEndpoint
  readonly project: string
}

export interface EndpointStore {
  read(): Promise<StoredScope | undefined>
  write(scope: StoredScope): Promise<void>
  clear(): Promise<void>
}

export interface ClientKeyStore {
  read(): Promise<string | undefined>
  write(key: string): Promise<void>
  clear(): Promise<void>
}

export interface IncusScope {
  readonly endpoint: IncusEndpoint
  readonly project: string
}

const SHA256 = /^[0-9a-f]{64}$/
const PROJECT = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/

export function parseProjectName(value: string): string {
  const name = value.trim()
  if (!PROJECT.test(name)) throw new Error(`"${value}" is not an Incus project name`)
  if (name === "default") throw new Error('bot VMs never use the Incus project "default"')
  return name
}

export function normalizeSha256(value: string): string {
  const normalized = value.replaceAll(":", "").toLowerCase()
  if (!SHA256.test(normalized)) throw new Error(`"${value}" is not a SHA-256 fingerprint`)
  return normalized
}

export function parseEndpointUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`"${value}" is not a URL`)
  }
  if (url.protocol !== "https:") throw new Error(`"${value}" is not an https:// URL`)
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(`"${value}" must name only the host and port`)
  }
  if (url.pathname !== "/" && url.pathname !== "") throw new Error(`"${value}" must have no path`)
  return url
}

const PEM_CERTIFICATE =
  /^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n?$/

function field(record: Readonly<Record<string, unknown>>, key: string, what: string): string {
  const value = record[key]
  if (typeof value !== "string" || value === "") throw new Error(`${what}: "${key}" is missing`)
  return value
}

function objectOf(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`)
  }
  return value as Record<string, unknown>
}

function endpointOfRecord(record: Readonly<Record<string, unknown>>, what: string): StoredEndpoint {
  switch (record.kind) {
    case "local": {
      const socket = field(record, "socket", what)
      if (!socket.startsWith("/")) throw new Error(`${what}: the socket must be an absolute path`)
      return { kind: "local", socket }
    }
    case "remote": {
      const url = parseEndpointUrl(field(record, "url", what)).origin
      const clientCertificate = field(record, "clientCertificate", what)
      if (!PEM_CERTIFICATE.test(clientCertificate)) {
        throw new Error(`${what}: the client certificate is not one PEM certificate`)
      }
      return {
        kind: "remote",
        url,
        serverCertificateSha256: normalizeSha256(field(record, "serverCertificateSha256", what)),
        clientCertificate,
      }
    }
    default:
      throw new Error(`${what} has an unknown kind`)
  }
}

const SCOPE_VERSION = 2

export function parseStoredScope(text: string, what = "the stored VM host"): StoredScope {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${what} is not JSON`)
  }
  const record = objectOf(value, what)
  if (record.version === 1) {
    throw new Error(
      `${what} was written by an earlier development version (no project); choose the VM host again in the dsh-bots settings`,
    )
  }
  if (record.version !== SCOPE_VERSION) throw new Error(`${what} has an unknown version`)
  return {
    endpoint: endpointOfRecord(objectOf(record.endpoint, `${what}: the endpoint`), what),
    project: parseProjectName(field(record, "project", what)),
  }
}

export function serializeStoredScope(scope: StoredScope): string {
  return `${JSON.stringify({ version: SCOPE_VERSION, project: scope.project, endpoint: scope.endpoint }, null, 2)}\n`
}

export async function endpointOf(
  stored: StoredEndpoint,
  keys: ClientKeyStore,
): Promise<IncusEndpoint> {
  if (stored.kind === "local") return stored
  const clientKey = await keys.read()
  if (clientKey === undefined) {
    throw new Error(
      `the client key for the VM host ${stored.url} is missing from DSH's secret store; pair this installation with the VM host again`,
    )
  }
  return { ...stored, clientKey }
}

export function storedOf(endpoint: IncusEndpoint): StoredEndpoint {
  if (endpoint.kind === "local") return endpoint
  const { clientKey: _, ...stored } = endpoint
  return stored
}
