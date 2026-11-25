/**
 * The transport of the stored endpoint, resolved on first use: the endpoint
 * file and the client key are read then, not at plugin start. A failure to
 * resolve fails that call and is tried again by the next one; once resolved,
 * the endpoint stays for the process.
 */
import type { IncusEndpoint } from "../host/endpoint"
import type { IncusTransport } from "../host/incus"
import { type ClosableIncusTransport, createIncusTransport } from "./incus-transport"

export interface EndpointTransport extends IncusTransport {
  kind(): Promise<IncusEndpoint["kind"]>
  close(): void
}

export function endpointTransport(resolve: () => Promise<IncusEndpoint>): EndpointTransport {
  let resolved: Promise<{ endpoint: IncusEndpoint; transport: ClosableIncusTransport }> | undefined
  const current = () => {
    resolved ??= resolve().then((endpoint) => ({
      endpoint,
      transport: createIncusTransport(endpoint),
    }))
    const attempt = resolved
    attempt.catch(() => {
      if (resolved === attempt) resolved = undefined
    })
    return attempt
  }
  return {
    kind: async () => (await current()).endpoint.kind,
    json: async (method, path, body, signal) =>
      (await current()).transport.json(method, path, body, signal),
    upload: async (path, body, headers, signal) =>
      (await current()).transport.upload(path, body, headers, signal),
    websocket: async (path, signal) => (await current()).transport.websocket(path, signal),
    close() {
      void resolved?.then(
        ({ transport }) => transport.close(),
        () => {},
      )
    },
  }
}
