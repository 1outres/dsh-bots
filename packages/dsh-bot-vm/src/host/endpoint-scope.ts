import type { ClientKeyStore, EndpointStore, IncusEndpoint, StoredScope } from "./endpoint"
import { endpointOf } from "./endpoint"
import type { IncusClient } from "./incus"

export interface ActiveScope {
  readonly kind: IncusEndpoint["kind"]
  readonly project: string
  readonly stored: StoredScope
  readonly chosen: boolean
  readonly incus: IncusClient
}

export interface ScopeConnection {
  readonly incus: IncusClient
  close(): void
}

export interface EndpointScopeDeps {
  readonly store: EndpointStore
  readonly keys: ClientKeyStore
  readonly defaults: StoredScope & { readonly endpoint: { readonly kind: "local" } }
  connect(endpoint: IncusEndpoint, project: string): ScopeConnection
}

export interface EndpointScope {
  readonly defaults: StoredScope & { readonly endpoint: { readonly kind: "local" } }
  current(): Promise<ActiveScope>
  project(): string | undefined
  stored(): Promise<StoredScope | undefined>
  choose(scope: StoredScope, clientKey?: string): Promise<void>
  keysUsable(): Promise<void>
  setProject(project: string): Promise<void>
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
