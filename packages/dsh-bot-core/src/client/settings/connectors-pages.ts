export type ConnectorsPage =
  | { readonly kind: "list" }
  | { readonly kind: "connector"; readonly connectorId: string }
  | { readonly kind: "accounts"; readonly provider: string }
  | { readonly kind: "senders"; readonly connectorId: string; readonly connectionId: string }

const CONNECTOR = "connector:"
const ACCOUNTS = "accounts:"
const SENDERS = "senders:"

export const connectorDetail = (connectorId: string): string => `${CONNECTOR}${connectorId}`

export const accountsDetail = (provider: string): string => `${ACCOUNTS}${provider}`

export const sendersDetail = (connectorId: string, connectionId: string): string =>
  `${SENDERS}${connectorId}:${connectionId}`

export function connectorsPageOf(detail: string | null): ConnectorsPage {
  if (detail?.startsWith(CONNECTOR) === true) {
    return { kind: "connector", connectorId: detail.slice(CONNECTOR.length) }
  }
  if (detail?.startsWith(ACCOUNTS) === true) {
    return { kind: "accounts", provider: detail.slice(ACCOUNTS.length) }
  }
  if (detail?.startsWith(SENDERS) === true) {
    const [connectorId, connectionId] = detail.slice(SENDERS.length).split(":")
    if (connectorId !== undefined && connectionId !== undefined) {
      return { kind: "senders", connectorId, connectionId }
    }
  }
  return { kind: "list" }
}
