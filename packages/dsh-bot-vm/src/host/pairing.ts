/**
 * Pairing with a VM host (docs/specs/incus-endpoint.md §4), what
 * `incus remote add <token>` does: connect to the URL the person chose with
 * the token's server fingerprint pinned, present a new client certificate,
 * and have the server trust it with the token. A restricted certificate
 * cannot remove itself from the server (Incus 6.0.4: 403 "Certificate is
 * restricted"), so unpairing tells the VM host's administrator what to run.
 */
import type { IncusEndpoint, StoredEndpoint } from "./endpoint"
import { parseEndpointUrl } from "./endpoint"
import type { IncusClient } from "./incus"
import type { TrustToken } from "./trust-token"

/** A client certificate and its key, made for one pairing. */
export interface ClientIdentity {
  /** PEM. */
  readonly certificate: string
  /** PEM (PKCS#8). */
  readonly key: string
  /** Lowercase hex SHA-256 of the certificate (DER), as Incus names it. */
  readonly fingerprint: string
}

export interface PairingDeps {
  /** A new identity (EC P-384, self-signed) named `commonName`. */
  createIdentity(commonName: string): Promise<ClientIdentity>
  /** A client of the endpoint, closed once pairing ended; pairing only calls server-wide endpoints. */
  connect(endpoint: IncusEndpoint): { readonly incus: IncusClient; close(): void }
  readonly now: () => number
}

export interface PairingRequest {
  readonly token: TrustToken
  /** One of the token's URLs, or the URL the server is reached at from here (NAT). */
  readonly url: string
  /** The client certificate's common name, e.g. "dsh-bots@<host>". */
  readonly name: string
}

export interface Paired {
  /** What to store as the endpoint. */
  readonly endpoint: StoredEndpoint & { readonly kind: "remote" }
  /** The client key to store apart from it. */
  readonly clientKey: string
}

/** @throws with what went wrong; nothing is stored then. */
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
    // Reach the pinned server before the token's secret is sent.
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

/** What the VM host's administrator runs to stop trusting this installation. */
export function untrustCommand(fingerprint: string): string {
  return `incus config trust remove ${fingerprint.slice(0, 12)}`
}
