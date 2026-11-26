import type { IncusClient } from "./client"
import { type IncusEndpoint, parseEndpointUrl } from "./endpoint"
import type { TrustToken } from "./trust-token"

export interface ClientIdentity {
  readonly certificate: string
  readonly key: string
  readonly fingerprint: string
}

export interface IncusConnection {
  readonly incus: IncusClient
  close(): void
}

export interface PairingDeps {
  createIdentity(commonName: string): Promise<ClientIdentity>
  connect(endpoint: IncusEndpoint, project: string): IncusConnection
  readonly now: () => number
}

export interface PairingRequest {
  readonly token: TrustToken
  readonly url: string
  readonly project: string
  readonly name: string
}

export async function pair(
  request: PairingRequest,
  deps: PairingDeps,
  signal?: AbortSignal,
): Promise<IncusEndpoint> {
  const { token } = request
  if (token.expiresAt !== undefined && token.expiresAt <= deps.now()) {
    throw new Error(
      `the trust token expired at ${new Date(token.expiresAt).toISOString()}; issue a new one on the VM host`,
    )
  }
  const url = parseEndpointUrl(request.url).origin
  const identity = await deps.createIdentity(request.name)
  const endpoint: IncusEndpoint = {
    url,
    serverCertificateSha256: token.fingerprint,
    clientCertificate: identity.certificate,
    clientKey: identity.key,
  }
  const connection = deps.connect(endpoint, request.project)
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
  return endpoint
}

export function untrustCommand(fingerprint: string): string {
  return `incus config trust remove ${fingerprint.slice(0, 12)}`
}
