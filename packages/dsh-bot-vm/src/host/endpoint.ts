/**
 * Where the Incus API is (docs/specs/incus-endpoint.md §5.1): this machine's
 * Unix socket, or a VM host over HTTPS whose server certificate was pinned at
 * pairing and that knows this installation's client certificate.
 */

/** An endpoint ready to connect to; the client key is held in memory only. */
export type IncusEndpoint =
  | { readonly kind: "local"; readonly socket: string }
  | {
      readonly kind: "remote"
      /** `https://host:port`. */
      readonly url: string
      /** Lowercase hex SHA-256 of the server certificate (DER); the only check of the server. */
      readonly serverCertificateSha256: string
      /** PEM. */
      readonly clientCertificate: string
      /** PEM (PKCS#8). */
      readonly clientKey: string
    }

/** What is stored of the endpoint: everything but the client key. */
export type StoredEndpoint =
  | { readonly kind: "local"; readonly socket: string }
  | {
      readonly kind: "remote"
      readonly url: string
      readonly serverCertificateSha256: string
      readonly clientCertificate: string
    }

/** The stored endpoint (state only: no logic). */
export interface EndpointStore {
  read(): Promise<StoredEndpoint | undefined>
  write(endpoint: StoredEndpoint): Promise<void>
  clear(): Promise<void>
}

/** The client key of the paired VM host, kept apart from the endpoint (state only). */
export interface ClientKeyStore {
  read(): Promise<string | undefined>
  write(key: string): Promise<void>
  clear(): Promise<void>
}

/** The endpoint and the project every request of this installation is scoped to. */
export interface IncusScope {
  readonly endpoint: IncusEndpoint
  readonly project: string
}

const SHA256 = /^[0-9a-f]{64}$/

/** A server certificate fingerprint as Incus prints it, normalized (lowercase, no colons). */
export function normalizeSha256(value: string): string {
  const normalized = value.replaceAll(":", "").toLowerCase()
  if (!SHA256.test(normalized)) throw new Error(`"${value}" is not a SHA-256 fingerprint`)
  return normalized
}

/** An `https://host:port` URL with nothing else. @throws on anything else. */
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

/** The stored endpoint as written by {@link serializeStoredEndpoint}. @throws on anything else. */
export function parseStoredEndpoint(text: string, what = "the stored VM host"): StoredEndpoint {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error(`${what} is not JSON`)
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${what} is not an object`)
  }
  const record = value as Record<string, unknown>
  if (record.version !== 1) throw new Error(`${what} has an unknown version`)
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

export function serializeStoredEndpoint(endpoint: StoredEndpoint): string {
  return `${JSON.stringify({ version: 1, ...endpoint }, null, 2)}\n`
}

/** The stored endpoint made connectable. @throws when a remote endpoint's key is missing. */
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

/** What is stored of a connectable endpoint. */
export function storedOf(endpoint: IncusEndpoint): StoredEndpoint {
  if (endpoint.kind === "local") return endpoint
  const { clientKey: _, ...stored } = endpoint
  return stored
}
