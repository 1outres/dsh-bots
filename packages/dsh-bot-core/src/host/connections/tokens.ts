import type { ConnectionStatus } from "../../shared/connections"
import {
  type ClientCredentials,
  OAuthError,
  type OAuthFetch,
  type OAuthTokens,
  refreshAccess,
} from "./oauth"
import type { ConnectionProviders } from "./providers"
import type { ConnectionStore } from "./store"
import type { ConnectionVault } from "./vault"

export interface ConnectionTokensDeps {
  store: Pick<ConnectionStore, "get" | "setStatus">
  vault: Pick<ConnectionVault, "grant" | "writeGrant">
  providers: Pick<ConnectionProviders, "get">
  /** The provider's OAuth client, when both its id and secret are set. */
  client(provider: string): Promise<ClientCredentials | undefined>
  fetch: OAuthFetch
  now(): number
  deadline(ms: number): AbortSignal
}

/**
 * Access tokens of connections, kept in memory only and refreshed with the
 * stored refresh token, one refresh per connection at a time. A refresh the
 * provider refuses marks the connection for signing in again.
 */
export interface ConnectionTokens {
  /** @throws with what the person must do when the connection cannot be used. */
  accessToken(connectionId: string, options?: { readonly refresh?: boolean }): Promise<string>
  /** Keep the access token a sign-in just got. */
  remember(connectionId: string, tokens: OAuthTokens): void
  forget(connectionId: string): void
}

/** Renew a token this long before it expires. */
const MARGIN_MS = 60_000
const REFRESH_TIMEOUT_MS = 30_000

interface Cached {
  readonly token: string
  readonly expiresAt: number
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function createConnectionTokens(deps: ConnectionTokensDeps): ConnectionTokens {
  const cache = new Map<string, Cached>()
  const flights = new Map<string, Promise<string>>()

  const refuse = async (connectionId: string, status: ConnectionStatus, reason: string) => {
    cache.delete(connectionId)
    await deps.store.setStatus(connectionId, status, reason)
    return new Error(
      `this account must be signed in again in the bot's Connectors settings: ${reason}`,
    )
  }

  const refresh = async (connectionId: string): Promise<string> => {
    const record = deps.store.get(connectionId)
    if (record === undefined) throw new Error("the account is no longer connected")
    const provider = deps.providers.get(record.provider)
    if (provider === undefined)
      throw new Error(`the provider "${record.provider}" is not registered now`)
    if (provider.oauth.tokenEndpoint !== record.issuer) {
      throw await refuse(
        connectionId,
        "error",
        `it was signed in at ${record.issuer}, not at the provider's current token endpoint`,
      )
    }
    const client = await deps.client(record.provider)
    if (client === undefined) throw new Error(`the ${provider.name} OAuth client is not set up`)
    let grant: Awaited<ReturnType<ConnectionVault["grant"]>>
    try {
      grant = await deps.vault.grant(connectionId)
    } catch (error) {
      throw await refuse(connectionId, "error", messageOf(error))
    }
    let tokens: OAuthTokens
    try {
      tokens = await refreshAccess(
        deps.fetch,
        record.issuer,
        client,
        grant.refreshToken,
        deps.deadline(REFRESH_TIMEOUT_MS),
      )
    } catch (error) {
      if (error instanceof OAuthError && error.code === "invalid_grant") {
        throw await refuse(connectionId, "needs-reauth", error.message)
      }
      throw new Error(`could not refresh the access of this account: ${messageOf(error)}`)
    }
    if (tokens.refreshToken !== undefined && tokens.refreshToken !== grant.refreshToken) {
      await deps.vault.writeGrant(connectionId, { ...grant, refreshToken: tokens.refreshToken })
    }
    cache.set(connectionId, {
      token: tokens.accessToken,
      expiresAt: deps.now() + tokens.expiresIn * 1000,
    })
    return tokens.accessToken
  }

  return {
    async accessToken(connectionId, options) {
      const record = deps.store.get(connectionId)
      if (record === undefined) throw new Error("the account is no longer connected")
      if (record.status !== "active") {
        throw new Error(
          `this account must be signed in again in the bot's Connectors settings (${record.status}${record.statusReason === undefined ? "" : `: ${record.statusReason}`})`,
        )
      }
      const cached = cache.get(connectionId)
      if (
        options?.refresh !== true &&
        cached !== undefined &&
        cached.expiresAt - MARGIN_MS > deps.now()
      ) {
        return cached.token
      }
      if (options?.refresh === true) cache.delete(connectionId)
      const running = flights.get(connectionId)
      if (running !== undefined) return running
      const flight = refresh(connectionId).finally(() => flights.delete(connectionId))
      flights.set(connectionId, flight)
      return flight
    },
    remember(connectionId, tokens) {
      cache.set(connectionId, {
        token: tokens.accessToken,
        expiresAt: deps.now() + tokens.expiresIn * 1000,
      })
    },
    forget(connectionId) {
      cache.delete(connectionId)
    },
  }
}
