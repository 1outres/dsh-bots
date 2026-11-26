export type ConnectionStatus = "active" | "needs-reauth" | "revoked" | "error"

export const CONNECTION_STATUSES: readonly ConnectionStatus[] = [
  "active",
  "needs-reauth",
  "revoked",
  "error",
]

export interface ConnectionAccount {
  readonly subject: string
  readonly email?: string
  readonly displayName?: string
}

export interface ConnectorConnectionInfo {
  readonly id: string
  readonly provider: string
  readonly services: readonly string[]
  readonly label: string
  readonly account: ConnectionAccount
  readonly grantedScopes: readonly string[]
  readonly status: ConnectionStatus
  readonly statusReason?: string
  readonly createdAt: number
  readonly authorizedAt: number
}

export interface ConnectionView extends ConnectorConnectionInfo {
  readonly bots: readonly string[]
}

export interface ConnectionServiceView {
  readonly connectorId: string
  readonly name: string
  readonly scopes: readonly string[]
}

export interface OAuthClientView {
  readonly clientId?: string
  readonly secretSet: boolean
  readonly configured: boolean
}

export interface ConnectionProviderView {
  readonly id: string
  readonly name: string
  readonly services: readonly ConnectionServiceView[]
  readonly client: OAuthClientView
  readonly callbackPath: string
  readonly development: boolean
  readonly guide?: string
}

export interface ConnectionAttemptView {
  readonly id: string
  readonly provider: string
  readonly services: readonly string[]
  readonly connectionId?: string
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

export interface BotConnectionsSnapshot {
  readonly providers: readonly ConnectionProviderView[]
  readonly connections: readonly ConnectionView[]
  readonly attempts: readonly ConnectionAttemptView[]
}

export type OAuthSecretChange =
  | { readonly op: "keep" }
  | { readonly op: "set"; readonly value: string }
  | { readonly op: "clear" }

export interface OAuthClientChange {
  readonly clientId: string
  readonly clientSecret: OAuthSecretChange
}

export interface ConnectionAuthorizeRequest {
  readonly provider: string
  readonly services: readonly string[]
  readonly label?: string
  readonly botId?: string
  readonly connectionId?: string
  readonly origin: string
}

export interface ConnectionAuthorization {
  readonly attemptId: string
  readonly url: string
  readonly redirectUri: string
  readonly expiresAt: number
}

export interface ConnectionRemoval {
  readonly connectionId: string
  readonly revoked: boolean
  readonly reason?: string
}

export interface BotConnectionsApi {
  watch(signal?: AbortSignal): AsyncIterable<BotConnectionsSnapshot>
  configureClient(provider: string, change: OAuthClientChange): Promise<ConnectionProviderView>
  authorize(request: ConnectionAuthorizeRequest): Promise<ConnectionAuthorization>
  rename(connectionId: string, label: string): Promise<ConnectionView>
  assign(botId: string, connectionId: string, assigned: boolean): Promise<ConnectionView>
  disconnect(connectionId: string): Promise<ConnectionRemoval>
}

export const CONNECTION_CALLBACK_PATH = "/bot-core/oauth/callback"

export const MAX_CONNECTION_LABEL = 60

export function connectionLabelProblem(label: string): string | undefined {
  const trimmed = label.trim()
  if (trimmed === "") return "the label is empty"
  if (trimmed.length > MAX_CONNECTION_LABEL)
    return `the label is longer than ${MAX_CONNECTION_LABEL} characters`
  if (/[\p{Cc}\p{Cf}]/u.test(trimmed)) return "the label has control characters"
  return undefined
}

export function connectionName(
  connection: Pick<ConnectorConnectionInfo, "label" | "account">,
): string {
  const { email } = connection.account
  return email === undefined || email.toLowerCase() === connection.label.toLowerCase()
    ? connection.label
    : `${connection.label} <${email}>`
}

export type ConnectorEventDelivery = "off" | "notify" | "queue"

export const CONNECTOR_EVENT_DELIVERIES: readonly ConnectorEventDelivery[] = [
  "off",
  "notify",
  "queue",
]
