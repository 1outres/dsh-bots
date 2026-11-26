/**
 * The VM host bot VMs run on now (docs/specs/incus-endpoint.md §5.1): the
 * stored choice, or this machine's socket and the configured project while
 * none is stored. It is connected on first use, again after a failed attempt,
 * and again after the choice changed; a change closes the earlier connection
 * (its streams, SSH relays included, end).
 */
import type { ClientKeyStore, EndpointStore, IncusEndpoint, StoredScope } from "./endpoint"
import { endpointOf } from "./endpoint"
import type { IncusClient } from "./incus"

export interface ActiveScope {
  readonly kind: IncusEndpoint["kind"]
  readonly project: string
  readonly stored: StoredScope
  /** Whether the person chose it; false while nothing is stored (this machine by default). */
  readonly chosen: boolean
  readonly incus: IncusClient
}

/** A connected client of one endpoint and project. */
export interface ScopeConnection {
  readonly incus: IncusClient
  close(): void
}

export interface EndpointScopeDeps {
  readonly store: EndpointStore
  readonly keys: ClientKeyStore
  /** What is used while nothing is stored. */
  readonly defaults: StoredScope & { readonly endpoint: { readonly kind: "local" } }
  connect(endpoint: IncusEndpoint, project: string): ScopeConnection
}

export interface EndpointScope {
  /** What is used while nothing is stored. */
  readonly defaults: StoredScope & { readonly endpoint: { readonly kind: "local" } }
  current(): Promise<ActiveScope>
  /** The project of the latest scope resolved or chosen; undefined before that and while the stored choice cannot be read. */
  project(): string | undefined
  /** The stored choice now (undefined: none). @throws when it cannot be read. */
  stored(): Promise<StoredScope | undefined>
  /** Store a new choice (with the key of a paired VM host) and connect to it from the next call on. */
  choose(scope: StoredScope, clientKey?: string): Promise<void>
  /** @throws when the client key of a paired VM host could not be kept (DSH's credential store is missing). */
  keysUsable(): Promise<void>
  /** Keep the VM host, use another project on it. */
  setProject(project: string): Promise<void>
  /** Forget the stored choice: this machine's socket by default again. */
  clear(): Promise<void>
  close(): void
}

interface Connected {
  readonly scope: ActiveScope
  readonly connection: ScopeConnection
}

export function createEndpointScope(deps: EndpointScopeDeps): EndpointScope {
  let resolved: Promise<Connected> | undefined
  let latest: string | undefined

  async function resolve(): Promise<Connected> {
    const stored = await deps.store.read()
    const scope = stored ?? deps.defaults
    const endpoint = await endpointOf(scope.endpoint, deps.keys)
    const connection = deps.connect(endpoint, scope.project)
    latest = scope.project
    return {
      connection,
      scope: {
        kind: endpoint.kind,
        project: scope.project,
        stored: scope,
        chosen: stored !== undefined,
        incus: connection.incus,
      },
    }
  }

  function drop(): void {
    const earlier = resolved
    resolved = undefined
    void earlier?.then(
      ({ connection }) => connection.close(),
      () => {},
    )
  }

  async function previousWasRemote(): Promise<boolean> {
    try {
      return (await deps.store.read())?.endpoint.kind === "remote"
    } catch {
      return true
    }
  }

  return {
    async current() {
      resolved ??= resolve()
      const attempt = resolved
      try {
        return (await attempt).scope
      } catch (error) {
        if (resolved === attempt) {
          resolved = undefined
          latest = undefined
        }
        throw error
      }
    },
    defaults: deps.defaults,
    project: () => latest,
    stored: () => deps.store.read(),
    async choose(scope, clientKey) {
      if (scope.endpoint.kind === "remote") {
        if (clientKey === undefined) throw new Error("a paired VM host needs its client key")
        await deps.keys.write(clientKey)
      } else if (await previousWasRemote()) {
        await deps.keys.clear()
      }
      await deps.store.write(scope)
      drop()
      latest = scope.project
    },
    async keysUsable() {
      await deps.keys.read()
    },
    async setProject(project) {
      const stored = (await deps.store.read()) ?? deps.defaults
      await deps.store.write({ endpoint: stored.endpoint, project })
      drop()
      latest = project
    },
    async clear() {
      if (await previousWasRemote()) await deps.keys.clear()
      await deps.store.clear()
      drop()
      latest = deps.defaults.project
    },
    close: drop,
  }
}
