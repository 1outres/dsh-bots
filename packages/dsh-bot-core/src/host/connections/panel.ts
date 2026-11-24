import {
  type BotConnectionsSnapshot,
  CONNECTION_CALLBACK_PATH,
  type ConnectionAuthorization,
  type ConnectionProviderView,
  type ConnectionRemoval,
  type ConnectionView,
  connectionLabelProblem,
} from "../../shared/connections"
import type { RemoteCaller } from "../connectors/approvals"
import type { OAuthClients } from "./clients"
import type { ConnectionRecord } from "./domain"
import { type OAuthFetch, revokeToken } from "./oauth"
import type { ConnectionProviders } from "./providers"
import type { ConnectionServices } from "./services"
import type { ConnectionSignIn } from "./signin"
import type { ConnectionStore } from "./store"
import type { ConnectionTokens } from "./tokens"
import type { ConnectionVault } from "./vault"

export interface ConnectionPanelDeps {
  providers: Pick<ConnectionProviders, "get" | "list" | "subscribe">
  services: ConnectionServices
  store: ConnectionStore
  clients: Pick<OAuthClients, "view" | "configure" | "subscribe">
  signIn: Pick<ConnectionSignIn, "start" | "attempts" | "subscribe">
  vault: Pick<ConnectionVault, "grant" | "removeGrant">
  tokens: Pick<ConnectionTokens, "forget">
  fetch: OAuthFetch
  deadline(ms: number): AbortSignal
  /** Whether the bot is stored. */
  exists(botId: string): boolean
}

/**
 * Connections as the owner manages them in the Web UI (the `botConnections`
 * Remote): every call is refused unless its caller is the DSH Host's owner.
 */
export interface ConnectionPanel {
  snapshot(): BotConnectionsSnapshot
  configureClient(
    caller: RemoteCaller | undefined,
    provider: string,
    change: unknown,
  ): Promise<ConnectionProviderView>
  authorize(caller: RemoteCaller | undefined, request: unknown): Promise<ConnectionAuthorization>
  rename(
    caller: RemoteCaller | undefined,
    connectionId: string,
    label: unknown,
  ): Promise<ConnectionView>
  assign(
    caller: RemoteCaller | undefined,
    botId: string,
    connectionId: string,
    assigned: unknown,
  ): Promise<ConnectionView>
  disconnect(caller: RemoteCaller | undefined, connectionId: string): Promise<ConnectionRemoval>
  subscribe(listener: () => void): () => void
}

const REVOKE_TIMEOUT_MS = 15_000

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

function owner(caller: RemoteCaller | undefined) {
  if (caller?.kind !== "owner") throw new Error("only the owner of this DSH manages connections")
}

export function createConnectionPanel(deps: ConnectionPanelDeps): ConnectionPanel {
  const viewOf = (record: ConnectionRecord): ConnectionView => {
    const { issuer: _, ...info } = record
    return { ...info, bots: deps.store.botsOf(record.id).filter((botId) => deps.exists(botId)) }
  }
  const providerView = (id: string): ConnectionProviderView => {
    const provider = deps.providers.get(id)
    if (provider === undefined) throw new Error(`the provider "${id}" is not registered`)
    return {
      id,
      name: provider.name,
      services: deps.services.of(id),
      client: deps.clients.view(id),
      callbackPath: CONNECTION_CALLBACK_PATH,
      development: provider.development === true,
      ...(provider.guide === undefined ? {} : { guide: provider.guide }),
    }
  }
  const require = (connectionId: unknown) => {
    const record = typeof connectionId === "string" ? deps.store.get(connectionId) : undefined
    if (record === undefined) throw new Error("no such connection")
    return record
  }
  return {
    snapshot: () => ({
      providers: deps.providers.list().map((provider) => providerView(provider.id)),
      connections: deps.store.list().map(viewOf),
      attempts: deps.signIn.attempts(),
    }),
    async configureClient(caller, provider, change) {
      owner(caller)
      providerView(provider)
      await deps.clients.configure(provider, change)
      return providerView(provider)
    },
    async authorize(caller, request) {
      owner(caller)
      return deps.signIn.start(request)
    },
    async rename(caller, connectionId, label) {
      owner(caller)
      require(connectionId)
      if (typeof label !== "string") throw new Error("the label must be text")
      const problem = connectionLabelProblem(label)
      if (problem !== undefined) throw new Error(problem)
      return viewOf(await deps.store.rename(connectionId, label.trim()))
    },
    async assign(caller, botId, connectionId, assigned) {
      owner(caller)
      const record = require(connectionId)
      if (!deps.exists(botId)) throw new Error(`bot "${botId}" does not exist`)
      if (typeof assigned !== "boolean") throw new Error("assigned must be true or false")
      await deps.store.assign(botId, record.id, assigned)
      return viewOf(require(connectionId))
    },
    async disconnect(caller, connectionId) {
      owner(caller)
      const record = require(connectionId)
      const endpoint = deps.providers.get(record.provider)?.oauth.revocationEndpoint
      let revoked = false
      let reason: string | undefined
      if (endpoint === undefined) {
        reason = "the provider offers no revocation; remove the access in the account's settings"
      } else {
        try {
          const grant = await deps.vault.grant(record.id)
          await revokeToken(
            deps.fetch,
            endpoint,
            grant.refreshToken,
            deps.deadline(REVOKE_TIMEOUT_MS),
          )
          revoked = true
        } catch (error) {
          reason = `the provider did not confirm the revocation (${messageOf(error)}); remove the access in the account's settings`
        }
      }
      deps.tokens.forget(record.id)
      await deps.vault.removeGrant(record.id)
      await deps.store.remove(record.id)
      return { connectionId: record.id, revoked, ...(reason === undefined ? {} : { reason }) }
    },
    subscribe(listener) {
      const offs = [
        deps.providers.subscribe(listener),
        deps.store.subscribe(listener),
        deps.clients.subscribe(listener),
        deps.signIn.subscribe(listener),
      ]
      return () => {
        for (const off of offs) off()
      }
    },
  }
}
