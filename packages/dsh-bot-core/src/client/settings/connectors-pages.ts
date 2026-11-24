/** The detail pages of a bot's Connectors section, as `page.detail` names them. */
export type ConnectorsPage =
  | { readonly kind: "list" }
  | { readonly kind: "connector"; readonly connectorId: string }
  | { readonly kind: "accounts"; readonly provider: string }

const CONNECTOR = "connector:"
const ACCOUNTS = "accounts:"

/** The detail id of a connector's page, for `openSettings(botId, connectors, detail)`. */
export const connectorDetail = (connectorId: string): string => `${CONNECTOR}${connectorId}`

/** The detail id of a provider's accounts page. */
export const accountsDetail = (provider: string): string => `${ACCOUNTS}${provider}`

/** The page a detail id names; the list for none or an id of no page. */
export function connectorsPageOf(detail: string | null): ConnectorsPage {
  if (detail?.startsWith(CONNECTOR) === true) {
    return { kind: "connector", connectorId: detail.slice(CONNECTOR.length) }
  }
  if (detail?.startsWith(ACCOUNTS) === true) {
    return { kind: "accounts", provider: detail.slice(ACCOUNTS.length) }
  }
  return { kind: "list" }
}
