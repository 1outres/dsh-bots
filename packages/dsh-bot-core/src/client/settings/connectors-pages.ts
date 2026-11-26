export type ConnectorsPage =
  | { readonly kind: "list" }
  | { readonly kind: "connector"; readonly connectorId: string }
  | { readonly kind: "accounts"; readonly provider: string }

const CONNECTOR = "connector:"
const ACCOUNTS = "accounts:"

export const connectorDetail = (connectorId: string): string => `${CONNECTOR}${connectorId}`

export const accountsDetail = (provider: string): string => `${ACCOUNTS}${provider}`

export function connectorsPageOf(detail: string | null): ConnectorsPage {
  if (detail?.startsWith(CONNECTOR) === true) {
    return { kind: "connector", connectorId: detail.slice(CONNECTOR.length) }
  }
  if (detail?.startsWith(ACCOUNTS) === true) {
    return { kind: "accounts", provider: detail.slice(ACCOUNTS.length) }
  }
  return { kind: "list" }
}
