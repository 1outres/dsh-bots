import {
  type BotConnectionsSnapshot,
  type ConnectionAttemptView,
  type ConnectionProviderView,
  type ConnectionView,
  connectionName,
} from "../shared/connections"
import type { BotConnectorView } from "../shared/connectors"

/** Ids of the providers the connectors act through, in the connectors' order. */
export function providerIdsOf(connectors: readonly BotConnectorView[]): readonly string[] {
  return [
    ...new Set(
      connectors.flatMap((view) =>
        view.connector.connections === undefined ? [] : [view.connector.connections.provider],
      ),
    ),
  ]
}

/** The providers whose connectors the bot's Connectors section lists, in the connectors' order. */
export function providersOf(
  snapshot: BotConnectionsSnapshot,
  connectors: readonly BotConnectorView[],
): readonly ConnectionProviderView[] {
  return providerIdsOf(connectors).flatMap((id) =>
    snapshot.providers.filter((provider) => provider.id === id),
  )
}

/** How a provider's accounts stand for one bot, worst first. */
export type ProviderStanding =
  | { readonly kind: "unconfigured" }
  | { readonly kind: "reauth"; readonly count: number }
  | { readonly kind: "none" }
  | { readonly kind: "connected"; readonly count: number }

export function providerStanding(
  snapshot: BotConnectionsSnapshot,
  provider: ConnectionProviderView,
  botId: string,
): ProviderStanding {
  if (!provider.client.configured) return { kind: "unconfigured" }
  const { assigned } = accountsFor(snapshot, provider.id, botId)
  if (assigned.length === 0) return { kind: "none" }
  return assigned.some((connection) => connection.status !== "active")
    ? { kind: "reauth", count: assigned.length }
    : { kind: "connected", count: assigned.length }
}

/** A provider's connections: the bot's first, then the others. */
export function accountsFor(snapshot: BotConnectionsSnapshot, provider: string, botId: string) {
  const mine = snapshot.connections.filter((connection) => connection.provider === provider)
  return {
    assigned: mine.filter((connection) => connection.bots.includes(botId)),
    others: mine.filter((connection) => !connection.bots.includes(botId)),
  }
}

/** The redirect URI to register: this page's origin and the provider's callback path. */
export const redirectUriOf = (
  origin: string,
  provider: Pick<ConnectionProviderView, "callbackPath">,
) => `${origin}${provider.callbackPath}`

export const attemptOf = (
  snapshot: BotConnectionsSnapshot,
  attemptId: string | undefined,
): ConnectionAttemptView | undefined =>
  attemptId === undefined
    ? undefined
    : snapshot.attempts.find((attempt) => attempt.id === attemptId)

export const accountLabel = (connection: Pick<ConnectionView, "label" | "account">) =>
  connectionName(connection)

/** Service names of a connection, as its provider names its connectors. */
export const servicesLabel = (provider: ConnectionProviderView, services: readonly string[]) =>
  provider.services
    .filter((service) => services.includes(service.connectorId))
    .map((service) => service.name)
    .join(", ")

/**
 * Open the sign-in in a new tab within the click (so no popup blocker stops
 * it), then send it where the Host answered; undefined when the browser
 * refused a tab (the page shows a link instead).
 */
export async function openSignIn(
  start: () => Promise<{ readonly url: string; readonly attemptId: string }>,
): Promise<{ readonly attemptId: string; readonly url: string; readonly opened: boolean }> {
  const tab = window.open("", "_blank")
  try {
    const authorization = await start()
    if (tab === null) return { ...authorization, opened: false }
    tab.opener = null
    tab.location.href = authorization.url
    return { ...authorization, opened: true }
  } catch (error) {
    tab?.close()
    throw error
  }
}
