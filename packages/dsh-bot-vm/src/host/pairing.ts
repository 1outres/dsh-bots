import type { IncusEndpoint, StoredEndpoint } from "./endpoint"
import { parseEndpointUrl } from "./endpoint"
import type { IncusClient } from "./incus"
import type { TrustToken } from "./trust-token"

export interface ClientIdentity {
  readonly certificate: string
  readonly key: string
  readonly fingerprint: string
}

export interface PairingDeps {
  createIdentity(commonName: string): Promise<ClientIdentity>
  connect(endpoint: IncusEndpoint): { readonly incus: IncusClient; close(): void }
  readonly now: () => number
}

export interface PairingRequest {
  readonly token: TrustToken
  readonly url: string
  readonly name: string
}

export interface Paired {
  readonly endpoint: StoredEndpoint & { readonly kind: "remote" }
  readonly clientKey: string
}

export async function pair(
  request: PairingRequest,
  deps: PairingDeps,
  signal?: AbortSignal,
): Promise<Paired> {
  const { token } = request
  if (token.expiresAt !== undefined && token.expiresAt <= deps.now()) {
    throw new Error(
      `the trust token expired at ${new Date(token.expiresAt).toISOString()}; issue a new one on the VM host`,
    )
  }
  const url = parseEndpointUrl(request.url).origin
  const identity = await deps.createIdentity(request.name)
  const endpoint: IncusEndpoint = {
    kind: "remote",
    url,
    serverCertificateSha256: token.fingerprint,
    clientCertificate: identity.certificate,
    clientKey: identity.key,
  }
  const connection = deps.connect(endpoint)
  try {
    const { incus } = connection
    await incus.server(signal)
    await incus.trustWithToken(token.text, signal)
    const after = await incus.server(signal)
    if (after.auth !== "trusted") {
      throw new Error(`the VM host ${url} accepted the trust token but does not trust this client`)
    }
  } finally {
    connection.close()
  }
  const { clientKey, ...stored } = endpoint
  return { endpoint: stored, clientKey }
}

export function untrustCommand(fingerprint: string): string {
  return `incus config trust remove ${fingerprint.slice(0, 12)}`
}
