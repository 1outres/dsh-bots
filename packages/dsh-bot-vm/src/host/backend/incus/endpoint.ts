export interface IncusEndpoint {
  readonly url: string
  readonly serverCertificateSha256: string
  readonly clientCertificate: string
  readonly clientKey: string
}

const SHA256 = /^[0-9a-f]{64}$/
const PROJECT = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/
const PEM_CERTIFICATE =
  /^-----BEGIN CERTIFICATE-----\n[A-Za-z0-9+/=\n]+-----END CERTIFICATE-----\n?$/

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

export function parseCertificate(value: string): string {
  if (!PEM_CERTIFICATE.test(value))
    throw new Error("the client certificate is not one PEM certificate")
  return value
}
