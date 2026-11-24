/**
 * Connections' wire shapes shared by the Host and the browser: outside
 * accounts (a Google account) that connectors act as, OAuth clients of their
 * providers, the bots each account is assigned to, sign-in attempts, how a
 * bot gets a connector's events, and the `botConnections` Remote.
 */

/**
 * Whether a connection can be used:
 * - `active`: its credentials work;
 * - `needs-reauth`: the provider refused its refresh token (a changed password, an expired grant); sign in again;
 * - `revoked`: the account's owner revoked the access; sign in again;
 * - `error`: bot-core cannot read its stored credentials.
 */
export type ConnectionStatus = "active" | "needs-reauth" | "revoked" | "error"

export const CONNECTION_STATUSES: readonly ConnectionStatus[] = [
  "active",
  "needs-reauth",
  "revoked",
  "error",
]

/** The outside account a connection acts as. */
export interface ConnectionAccount {
  /** The provider's stable id of the account (Google's `sub`). */
  readonly subject: string
  readonly email?: string
  readonly displayName?: string
}

/** One connection as bot-core stores it: never a secret, only what people and tools see. */
export interface ConnectorConnectionInfo {
  /** `conn-<hex>`, stable. */
  readonly id: string
  readonly provider: string
  /** Connectors of the provider whose scopes the account granted. */
  readonly services: readonly string[]
  /** Its name for people and bots (the email unless renamed). */
  readonly label: string
  readonly account: ConnectionAccount
  readonly grantedScopes: readonly string[]
  readonly status: ConnectionStatus
  readonly statusReason?: string
  readonly createdAt: number
  readonly authorizedAt: number
}

/** A connection with the bots it is assigned to. */
export interface ConnectionView extends ConnectorConnectionInfo {
  readonly bots: readonly string[]
}

/** One connector a provider's accounts serve, with the scopes it needs. */
export interface ConnectionServiceView {
  readonly connectorId: string
  readonly name: string
  readonly scopes: readonly string[]
}

/** The OAuth client of a provider as the browser sees it: whether it is set, never the secret. */
export interface OAuthClientView {
  readonly clientId?: string
  readonly secretSet: boolean
  /** Both the id and the secret are set. */
  readonly configured: boolean
}

/** A provider of connections (Google) with its OAuth client and services. */
export interface ConnectionProviderView {
  readonly id: string
  readonly name: string
  /** Connectors registered for this provider. */
  readonly services: readonly ConnectionServiceView[]
  readonly client: OAuthClientView
  /** Where the provider sends the browser back: `<DSH origin><callbackPath>` is the redirect URI to register. */
  readonly callbackPath: string
  /** Set only by a development configuration (a fake provider). */
  readonly development: boolean
  /** An https page that walks through setting up its OAuth client. */
  readonly guide?: string
}

/** A sign-in started from the Web UI and not finished yet, or how it ended. */
export interface ConnectionAttemptView {
  readonly id: string
  readonly provider: string
  readonly services: readonly string[]
  /** The connection it signs in again. */
  readonly connectionId?: string
  /** The bot the new connection is assigned to. */
  readonly botId?: string
  readonly startedAt: number
  readonly expiresAt: number
  readonly state: ConnectionAttemptState
}

export type ConnectionAttemptState =
  | { readonly kind: "waiting" }
  | { readonly kind: "exchanging" }
  | { readonly kind: "connected"; readonly connectionId: string; readonly at: number }
  | { readonly kind: "failed"; readonly reason: string; readonly at: number }

/** What the `botConnections` Remote's `watch` streams. */
export interface BotConnectionsSnapshot {
  readonly providers: readonly ConnectionProviderView[]
  readonly connections: readonly ConnectionView[]
  /** Attempts of the last few minutes, newest first. */
  readonly attempts: readonly ConnectionAttemptView[]
}

/** How a save treats the OAuth client secret: unchanged, replaced, or removed. */
export type OAuthSecretChange =
  | { readonly op: "keep" }
  | { readonly op: "set"; readonly value: string }
  | { readonly op: "clear" }

export interface OAuthClientChange {
  /** Empty removes the client id. */
  readonly clientId: string
  readonly clientSecret: OAuthSecretChange
}

/** A sign-in the owner starts in the Web UI. */
export interface ConnectionAuthorizeRequest {
  readonly provider: string
  /** Connectors of the provider to grant access for (at least one). */
  readonly services: readonly string[]
  /** The name of a new connection; the email when absent. */
  readonly label?: string
  /** Assign the new connection to this bot. */
  readonly botId?: string
  /** Sign this connection in again (the same account only). */
  readonly connectionId?: string
  /** The origin the Web UI is served from; the redirect URI is `<origin><callbackPath>`. */
  readonly origin: string
}

/** Where the browser goes to sign in. */
export interface ConnectionAuthorization {
  readonly attemptId: string
  readonly url: string
  readonly redirectUri: string
  readonly expiresAt: number
}

/** What disconnecting did: the provider may not have confirmed the revocation. */
export interface ConnectionRemoval {
  readonly connectionId: string
  readonly revoked: boolean
  readonly reason?: string
}

/** The `botConnections` Remote: outside accounts, their providers' OAuth clients, and their bots. Owner only. */
export interface BotConnectionsApi {
  watch(signal?: AbortSignal): AsyncIterable<BotConnectionsSnapshot>
  configureClient(provider: string, change: OAuthClientChange): Promise<ConnectionProviderView>
  authorize(request: ConnectionAuthorizeRequest): Promise<ConnectionAuthorization>
  rename(connectionId: string, label: string): Promise<ConnectionView>
  assign(botId: string, connectionId: string, assigned: boolean): Promise<ConnectionView>
  disconnect(connectionId: string): Promise<ConnectionRemoval>
}

/** The path of bot-core's OAuth redirect route on DSH's web server. */
export const CONNECTION_CALLBACK_PATH = "/bot-core/oauth/callback"

/** Longest connection label. */
export const MAX_CONNECTION_LABEL = 60

/** A label as stored: trimmed, 1 to {@link MAX_CONNECTION_LABEL} characters, no control characters. */
export function connectionLabelProblem(label: string): string | undefined {
  const trimmed = label.trim()
  if (trimmed === "") return "the label is empty"
  if (trimmed.length > MAX_CONNECTION_LABEL)
    return `the label is longer than ${MAX_CONNECTION_LABEL} characters`
  if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) return "the label has control characters"
  return undefined
}

/** How a connection is named to bots and people: its label and, when it differs, its email. */
export function connectionName(
  connection: Pick<ConnectorConnectionInfo, "label" | "account">,
): string {
  const { email } = connection.account
  return email === undefined || email.toLowerCase() === connection.label.toLowerCase()
    ? connection.label
    : `${connection.label} <${email}>`
}

/**
 * How a bot gets a connector's events:
 * - `off`: not at all (the default);
 * - `notify`: its Main session is told of them, a few at a time;
 * - `queue`: they wait until the bot lists and acknowledges them (`<connector>_events_list` / `_events_ack`).
 */
export type ConnectorEventDelivery = "off" | "notify" | "queue"

export const CONNECTOR_EVENT_DELIVERIES: readonly ConnectorEventDelivery[] = [
  "off",
  "notify",
  "queue",
]
